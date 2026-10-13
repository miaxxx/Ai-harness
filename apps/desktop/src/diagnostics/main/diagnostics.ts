/** Asynchronous per-request ACP diagnostics, owned by Electron Main. */
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_PENDING_BYTES = 8 * 1024 * 1024
const MAX_RECORD_BYTES = 1024 * 1024
const MAX_FILE_BYTES = 32 * 1024 * 1024
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000

function directory(root: string, sessionId: string): string {
  return join(root, createHash('sha256').update(sessionId).digest('hex'))
}

/** Redact structured credentials and common credential assignments in diagnostic text. */
export function diagnosticJson(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value === undefined ? null : value, (key, item: unknown) => {
    if (/api.?key|authorization|password|secret|(?:access|refresh|delegated|bearer|session|id)[._-]?token|(^|[_-])token$|capability.?lease|cookie|credential/i.test(key)) return '[REDACTED]'
    if (key === 'data' && typeof item === 'string' && item.length > 4096) return '[binary omitted]'
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) return '[circular reference]'
      seen.add(item)
    }
    if (item instanceof Error) return {
      ...Object.fromEntries(Object.entries(item)), name: item.name,
      message: item.message, stack: item.stack, cause: item.cause,
    }
    if (typeof item === 'string') return item
      .replace(/\b((?:set-)?cookie\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
      .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/\b((?:[A-Z_]*API_KEY|password|secret|[A-Z_]*TOKEN|capability[_-]?lease|cookie|credential)\s*[:=]\s*["']?)[^\s,"']+/gi, '$1[REDACTED]')
    return item
  })
}

/** One diagnostic file with bounded asynchronous batches and an inactivity watchdog. */
export class DesktopTurnLog {
  private pending: string[] = []
  private pendingBytes = 0
  private inflightBytes = 0
  private fileBytes = 0
  private dropped = 0
  private writing: Promise<void> = Promise.resolve()
  private lastActivity = Date.now()
  private lastWarning = 0
  private lastTick = Date.now()
  private phase = 'preparing-request'
  private readonly timer: ReturnType<typeof setInterval>
  private failure: Error | undefined
  private flushing = false

  constructor(readonly path: string, private readonly report: (error: Error) => void) {
    this.timer = setInterval(() => {
      const now = Date.now()
      if (now - this.lastTick > 2000) this.record('main-loop-delay', { delayMs: now - this.lastTick - 250 }, false)
      this.lastTick = now
      if (now - this.lastActivity >= 60_000 && now - this.lastWarning >= 60_000) {
        this.lastWarning = now
        this.record('inactivity', { phase: this.phase, idleMs: now - this.lastActivity, mainMemory: process.memoryUsage() }, false)
      }
      if (!this.flushing && this.pending.length > 0) void this.flush()
    }, 250)
    this.timer.unref()
  }

  /** Queue evidence; explicit overflow records preserve the fact of diagnostic loss. */
  record(kind: string, data: unknown, activity = true): void {
    if (activity) this.lastActivity = Date.now()
    let payload = diagnosticJson(data)
    let line = `{"time":"${new Date().toISOString()}","kind":${JSON.stringify(kind)},"data":${payload}}\n`
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
      payload = diagnosticJson({
        truncated: true, originalBytes: Buffer.byteLength(payload),
        preview: payload.slice(0, Math.floor(MAX_RECORD_BYTES / 8)),
      })
    }
    line = `{"time":"${new Date().toISOString()}","kind":${JSON.stringify(kind)},"data":${payload}}\n`
    const bytes = Buffer.byteLength(line)
    if (this.pendingBytes + this.inflightBytes + bytes > MAX_PENDING_BYTES || this.fileBytes + this.pendingBytes + bytes > MAX_FILE_BYTES) {
      this.dropped += 1
      return
    }
    this.pending.push(line)
    this.pendingBytes += bytes
  }

  /** Record the active wait source without treating the watchdog as progress. */
  setPhase(phase: string): void {
    if (phase === this.phase) return
    this.phase = phase
    this.record('phase', { phase })
  }

  /** Drain queued records in order; filesystem failures never reject model execution. */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.writing
      return this.flush()
    }
    if (this.pending.length === 0 && this.dropped === 0) return this.writing
    this.flushing = true
    const records = this.pending.splice(0)
    this.pendingBytes = 0
    if (this.dropped > 0) {
      records.push(`${diagnosticJson({ time: new Date().toISOString(), kind: 'diagnostic-loss', data: { dropped: this.dropped } })}\n`)
      this.dropped = 0
    }
    const batch = records.join('')
    this.inflightBytes = Buffer.byteLength(batch)
    this.fileBytes += Buffer.byteLength(batch)
    this.writing = this.writing.then(async () => {
      await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 })
      await appendFile(this.path, batch, { mode: 0o600 })
    }).catch((error: unknown) => {
      if (this.failure === undefined) {
        this.failure = error instanceof Error ? error : new Error(String(error))
        this.report(this.failure)
      }
    }).finally(() => { this.flushing = false; this.inflightBytes = 0 })
    return this.writing
  }

  /** Stop monitoring, persist the final outcome, and drain the writer. */
  async finish(kind: string, data: unknown): Promise<void> {
    clearInterval(this.timer)
    const json = diagnosticJson(data)
    const evidence: unknown = json.length > 128_000 ? { truncated: true, preview: json.slice(0, 128_000) } : JSON.parse(json) as unknown
    const line = `${diagnosticJson({ time: new Date().toISOString(), kind, data: evidence })}\n`
    this.pending.push(line)
    this.pendingBytes += Buffer.byteLength(line)
    await this.flush()
  }

  /** Flush before opening and expose a write failure to the log-opening UI. */
  async ready(): Promise<string> {
    await this.flush()
    if (this.failure !== undefined) throw this.failure
    return this.path
  }
}

/** Per-session request ownership and persistent message-to-file lookup. */
export class DesktopDiagnostics {
  private readonly active = new Map<string, DesktopTurnLog>()
  private lastPrune = 0
  private readonly finishing = new Map<string, Set<DesktopTurnLog>>()
  constructor(private readonly root: string, private readonly report: (error: Error) => void) {}

  /** Start before runtime startup or attachment preparation so their failures are recorded. */
  begin(sessionId: string, data: unknown): DesktopTurnLog {
    if (this.active.has(sessionId)) throw new Error('This session already has an active request')
    const log = new DesktopTurnLog(join(directory(this.root, sessionId), `${Date.now()}-${randomUUID()}.jsonl`), this.report)
    this.active.set(sessionId, log)
    log.record('request', data)
    if (Date.now() - this.lastPrune > 60 * 60 * 1000) {
      this.lastPrune = Date.now()
      void this.prune().catch(this.report)
    }
    return log
  }

  /** Record live session evidence, including message identity for later lookup. */
  record(sessionId: string, kind: string, data: unknown): void {
    this.active.get(sessionId)?.record(kind, data)
  }

  /** Set the active request's diagnostic wait source. */
  phase(sessionId: string, phase: string): void {
    this.active.get(sessionId)?.setPhase(phase)
  }

  /** Record process-wide failure evidence in each affected active request. */
  broadcast(kind: string, data: unknown): void {
    for (const log of this.active.values()) log.record(kind, data, false)
  }

  /** End only the request that owns the current session reservation. */
  async finish(sessionId: string, log: DesktopTurnLog, kind: string, data: unknown): Promise<void> {
    const set = this.finishing.get(sessionId) ?? new Set<DesktopTurnLog>()
    this.finishing.set(sessionId, set)
    set.add(log)
    if (this.active.get(sessionId) === log) this.active.delete(sessionId)
    try { await log.finish(kind, data) } finally {
      set.delete(log)
      if (set.size === 0) this.finishing.delete(sessionId)
    }
  }

  /** Resolve host-owned files only, including after application restart. */
  async find(sessionId: string, messageId: string): Promise<string> {
    await Promise.all([...(this.finishing.get(sessionId) ?? [])].map(log => log.ready()))
    const active = this.active.get(sessionId)
    if (active !== undefined) await active.ready()
    const dir = directory(this.root, sessionId)
    const names = await readdir(dir).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    const files = names.filter(name => /^\d+-[a-f0-9-]+\.jsonl$/.test(name)).sort().reverse()
    for (const name of files) {
      const path = join(dir, name)
      const contents = await readFile(path, 'utf8')
      for (const line of contents.slice(0, contents.lastIndexOf('\n') + 1).split('\n')) {
        if (!line) continue
        const record = JSON.parse(line) as {
          kind: string
          data?: { update?: {
            messageId?: string
            _meta?: { harnessDiagnostics?: { kind: string
              data?: {
                type?: string
                data?: { id?: string; message?: { id?: string } }
              } } }
          } }
        }
        if (record.kind !== 'session-update') continue
        const update = record.data?.update
        if (update?.messageId === messageId) return path
        const diagnostic = update?._meta?.harnessDiagnostics
        if (diagnostic?.kind !== 'session-event') continue
        const event = diagnostic.data
        if (event?.type === 'user/message' && event.data?.id === messageId) return path
        if (event?.type === 'assistant/message' && event.data?.message?.id === messageId) return path
      }
    }
    throw new Error('本轮日志不存在或已超过 14 天保留期限')
  }

  /** Drain active evidence on orderly application shutdown. */
  async shutdown(): Promise<void> {
    await Promise.all([...this.active].map(([sessionId, log]) => this.finish(sessionId, log, 'interrupted', { reason: 'application-shutdown' })))
    // Each writer reports its own failure; shutdown only waits for completed writes.
    await Promise.all([...this.finishing.values()].flatMap(set => [...set].map(log => log.ready().catch(() => {}))))
  }

  private async prune(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const files: Array<{ path: string; mtime: number; size: number }> = []
    const active = new Set([
      ...this.active.values(), ...[...this.finishing.values()].flatMap(set => [...set]),
    ].map(log => log.path))
    for (const dir of await readdir(this.root, { withFileTypes: true })) {
      if (!dir.isDirectory() || !/^[a-f0-9]{64}$/.test(dir.name)) continue
      for (const file of await readdir(join(this.root, dir.name))) {
        if (!/^\d+-[a-f0-9-]+\.jsonl$/.test(file)) continue
        const path = join(this.root, dir.name, file)
        const info = await stat(path)
        files.push({ path, mtime: info.mtimeMs, size: info.size })
      }
    }
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
      if (active.has(file.path)) continue
      if (Date.now() - file.mtime > RETENTION_MS || total > 1024 * 1024 * 1024) {
        await unlink(file.path)
        total -= file.size
      }
    }
  }
}
