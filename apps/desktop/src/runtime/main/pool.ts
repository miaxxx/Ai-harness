/** Leased ACP revisions; enterprise invalidation retires every revision before reuse. */
import type { BrowserWindow } from 'electron'
import type { StoredModelSettings } from '../../desktop-model-storage.ts'
import type { DesktopPromptPart } from '../../desktop-prompt.ts'
import type { DesktopPromptResult, DesktopSessionSummary } from '../../shared.ts'

/** Operations supplied by the enterprise-aware ACP supervisor. */
export interface DesktopModelRuntime {
  attachWindow(window: BrowserWindow): void
  running(): boolean
  start(): Promise<void>
  stop(silent?: boolean): Promise<void>
  listSessions(cwd?: string): Promise<DesktopSessionSummary[]>
  createSession(cwd: string): Promise<string>
  loadSession(id: string, cwd: string): Promise<void>
  prepareSession(id: string): Promise<string>
  prompt(id: string, parts: readonly DesktopPromptPart[]): Promise<DesktopPromptResult>
  cancel(id: string): void
  closeSession(id: string): Promise<void>
}

interface OwnedSession {
  runtime?: DesktopModelRuntime
  cwd: string
  submitted: boolean
  prepared: boolean
}

/** Model changes preserve active leases; identity and tool changes revoke all leases. */
export class DesktopRuntimePool {
  private window: BrowserWindow | undefined
  private current: { key: string; runtime: DesktopModelRuntime } | undefined
  private readonly instances = new Set<DesktopModelRuntime>()
  private readonly leases = new Map<DesktopModelRuntime, number>()
  private readonly active = new Map<string, DesktopModelRuntime>()
  private readonly cancelled = new Set<string>()
  private readonly admissions = new Set<string>()
  private readonly sessions = new Map<string, OwnedSession>()
  private switching: Promise<unknown> = Promise.resolve()
  private generation = 0
  private closed = false

  constructor(
    private readonly readSettings: () => Promise<StoredModelSettings | undefined>,
    private readonly createRuntime: (snapshot: StoredModelSettings | undefined) => DesktopModelRuntime,
    private readonly getWorkspace: () => string,
    private readonly transferDraft: (previous: string, next: string) => void,
  ) {}

  /** Attach the local window to every owned subprocess. */
  attachWindow(window: BrowserWindow): void {
    this.window = window
    for (const runtime of this.instances) runtime.attachWindow(window)
  }
  /** Whether any subprocess is still owned, including one starting asynchronously. */
  running(): boolean { return this.instances.size > 0 }
  /** Whether a session operation already holds admission. */
  busy(id: string): boolean { return this.admissions.has(id) }
  /** Whether an admitted prompt is still executing. */
  hasActivePrompts(): boolean { return this.active.size > 0 }
  /** Default cwd used when creating a session. */
  workspace(): string { return this.getWorkspace() }

  private async acquire(): Promise<DesktopModelRuntime> {
    const generation = this.generation
    const pending = this.switching.then(async () => {
      if (this.closed || generation !== this.generation) throw new Error('Runtime 配置已变更，请重试')
      const snapshot = await this.readSettings()
      if (generation !== this.generation) throw new Error('企业作用域已变更')
      const key = JSON.stringify(snapshot)
      let runtime = this.current !== undefined && this.current.key === key ? this.current.runtime : undefined
      if (runtime === undefined) {
        const previous = this.current?.runtime
        runtime = this.createRuntime(snapshot)
        if (this.window !== undefined) runtime.attachWindow(this.window)
        this.instances.add(runtime)
        this.current = { key, runtime }
        if (previous !== undefined && !this.leases.has(previous)) await this.retire(previous)
      }
      if (generation !== this.generation) throw new Error('企业作用域或工具配置已变更')
      this.leases.set(runtime, (this.leases.get(runtime) ?? 0) + 1)
      return runtime
    })
    this.switching = pending.catch(() => { /* A rejected acquisition does not poison later revisions. */ })
    return pending
  }
  private async retire(runtime: DesktopModelRuntime): Promise<void> {
    await runtime.stop(true)
    this.instances.delete(runtime)
    for (const session of this.sessions.values()) if (session.runtime === runtime) delete session.runtime
  }
  private async release(runtime: DesktopModelRuntime): Promise<void> {
    const remaining = (this.leases.get(runtime) ?? 1) - 1
    if (remaining > 0) this.leases.set(runtime, remaining)
    else {
      this.leases.delete(runtime)
      if (runtime !== this.current?.runtime && this.instances.has(runtime)) await this.retire(runtime)
    }
  }
  private async use<T>(operation: (runtime: DesktopModelRuntime) => Promise<T>): Promise<T> {
    const generation = this.generation
    const runtime = await this.acquire()
    try {
      const result = await operation(runtime)
      if (generation !== this.generation) throw new Error('企业作用域或工具配置已变更')
      return result
    } finally { await this.release(runtime) }
  }

  /** Start the selected revision without releasing active older revisions. */
  async start(): Promise<void> {
    await this.use(runtime => runtime.start())
    this.publishStatus('ready')
  }
  private publishStatus(status: 'ready' | 'stopped'): void {
    const window = this.window
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send('dsh:frame', { type: 'runtime-status', status })
  }
  /** Revoke all subprocesses on identity or tool changes; new operations wait for disposal. */
  invalidate(clearSessions = false): Promise<void> {
    this.generation++
    this.publishStatus('stopped')
    const retiring = [...this.instances].map(runtime => this.retire(runtime))
    this.current = undefined
    for (const session of this.sessions.values()) { delete session.runtime; session.prepared = false }
    if (clearSessions) this.sessions.clear()
    const pending = this.switching.then(async () => {
      const results = await Promise.allSettled(retiring)
      this.leases.clear()
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
    this.switching = pending
    return pending
  }
  /** Rotate tool configuration and initialize its selected revision. */
  async restart(): Promise<void> { await this.invalidate(); await this.start() }
  /** Permanently close the pool after awaiting subprocess disposal. */
  async stop(): Promise<void> { this.closed = true; await this.invalidate() }
  /** List sessions through the supervisor's enterprise filter. */
  listSessions(cwd?: string): Promise<DesktopSessionSummary[]> { return this.use(runtime => runtime.listSessions(cwd)) }
  /** Create an empty session; its first prompt establishes the durable log. */
  createSession(cwd = this.getWorkspace(), replaceEmptySessionId?: string): Promise<string> {
    if (replaceEmptySessionId !== undefined && this.admissions.has(replaceEmptySessionId)) throw new Error('同一会话已有操作正在运行')
    return this.use(async (runtime) => {
      const previous = replaceEmptySessionId === undefined ? undefined : this.sessions.get(replaceEmptySessionId)
      if (replaceEmptySessionId !== undefined && (!previous || previous.submitted || previous.cwd !== cwd)) throw new Error('只能重新建立当前工作区的空会话')
      const id = await runtime.createSession(cwd)
      if (replaceEmptySessionId !== undefined) {
        this.transferDraft(replaceEmptySessionId, id)
        if (previous?.runtime) await previous.runtime.closeSession(replaceEmptySessionId)
        if (previous?.prepared && previous.runtime) await this.release(previous.runtime)
        this.sessions.delete(replaceEmptySessionId)
      }
      this.sessions.set(id, { runtime, cwd, submitted: false, prepared: false })
      return id
    })
  }
  /** Restore a durable session only when no operation on that session is active. */
  async loadSession(id: string, cwd = this.getWorkspace()): Promise<void> {
    if (this.admissions.has(id)) throw new Error('任务正在运行，请结束后再恢复会话')
    this.admissions.add(id)
    try {
      await this.use(async (runtime) => {
        const session = this.sessions.get(id)
        if (session?.prepared && session.runtime) await this.release(session.runtime)
        if (session?.runtime && session.runtime !== runtime && this.instances.has(session.runtime)) await session.runtime.closeSession(id)
        await runtime.loadSession(id, cwd)
        this.sessions.set(id, { runtime, cwd, submitted: true, prepared: false })
      })
    } finally { this.admissions.delete(id) }
  }
  /** Prepare and pin one revision until prompt/close; empty sessions are rebuilt without replay. */
  async prepareSession(id: string): Promise<string> {
    if (this.admissions.has(id)) throw new Error('同一会话已有操作正在运行')
    this.admissions.add(id)
    const generation = this.generation
    let acquired: DesktopModelRuntime | undefined
    try {
      const session = this.sessions.get(id)
      if (session?.prepared) return id
      const runtime = await this.acquire()
      acquired = runtime
      const cwd = session?.cwd ?? this.getWorkspace()
      let nextId = id
      if (session?.runtime !== runtime) {
        if (session?.runtime && this.instances.has(session.runtime)) await session.runtime.closeSession(id)
        if (session && !session.submitted) nextId = await runtime.createSession(cwd)
        else await runtime.loadSession(id, cwd)
      }
      nextId = await runtime.prepareSession(nextId)
      if (generation !== this.generation) throw new Error('企业作用域已变更')
      if (nextId !== id) {
        this.transferDraft(id, nextId); this.sessions.delete(id)
        if (this.cancelled.delete(id)) this.cancelled.add(nextId)
      }
      this.sessions.set(nextId, { runtime, cwd, submitted: session?.submitted ?? true, prepared: true })
      acquired = undefined
      return nextId
    } finally {
      if (acquired) await this.release(acquired)
      this.admissions.delete(id)
    }
  }
  /** Send once through the pinned revision, routing cancellation to its real subprocess. */
  async prompt(id: string, parts: readonly DesktopPromptPart[]): Promise<DesktopPromptResult> {
    if (this.admissions.has(id)) throw new Error('同一会话已有操作正在运行')
    if (!this.sessions.get(id)?.prepared) {
      const next = await this.prepareSession(id)
      if (next !== id) throw new Error('空会话已重建，请重新准备后发送')
    }
    if (this.admissions.has(id)) throw new Error('同一会话已有任务正在运行')
    const session = this.sessions.get(id)
    if (!session?.runtime) throw new Error('Runtime 配置已变更，请重新准备会话')
    const runtime = session.runtime
    const generation = this.generation
    this.admissions.add(id)
    session.prepared = false
    this.active.set(id, runtime)
    try {
      if (this.cancelled.has(id)) return { stopReason: 'cancelled', artifacts: [] }
      session.submitted = true
      const result = await runtime.prompt(id, parts)
      if (generation !== this.generation) throw new Error('企业作用域或工具配置已变更')
      return result
    } finally {
      this.active.delete(id); this.admissions.delete(id); this.cancelled.delete(id)
      await this.release(runtime)
    }
  }
  /** Cancel the owning revision, including admission waiting for preparation. */
  cancel(id: string): void {
    if (this.admissions.has(id) || this.sessions.get(id)?.prepared) this.cancelled.add(id)
    this.active.get(id)?.cancel(id)
  }
  /** Close a session and release any unused preparation lease. */
  async closeSession(id: string): Promise<void> {
    if (this.admissions.has(id)) throw new Error('请先停止任务再关闭会话')
    const session = this.sessions.get(id)
    if (session?.runtime) {
      await session.runtime.closeSession(id)
      if (session.prepared) await this.release(session.runtime)
    }
    this.sessions.delete(id)
    this.cancelled.delete(id)
  }
}
