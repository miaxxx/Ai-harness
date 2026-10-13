import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopDiagnostics, DesktopTurnLog, diagnosticJson } from '../src/diagnostics/main/diagnostics.ts'

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'mona-diagnostics-'))
  roots.push(path)
  return path
}

describe('Desktop request diagnostics', () => {
  it('applies the byte limit to the complete record including its timestamp and kind', async () => {
    const dir = await root()
    const log = new DesktopTurnLog(join(dir, 'boundary.jsonl'), () => {})
    log.record('boundary', 'x'.repeat(1024 * 1024 - 20))
    await log.finish('completed', {})
    const first = (await readFile(log.path, 'utf8')).split('\n')[0]!
    expect(Buffer.byteLength(first + '\n')).toBeLessThanOrEqual(1024 * 1024)
    expect((JSON.parse(first) as { data: { truncated: boolean } }).data.truncated).toBe(true)
  })
  it('redacts enterprise leases, cookies and nested failures while preserving model capacities', () => {
    const text = diagnosticJson({ capabilityLease: 'private-lease', cookie: 'private-cookie',
      OBIS_DELEGATED_ACCESS_TOKEN: 'private-token', maxOutputTokens: 4096,
      error: new Error('capabilityLease="private-lease" Cookie: first=private-cookie; second=private-second', { cause: { refreshToken: 'private-refresh' } }),
    })
    expect(text).not.toMatch(/private-/)
    expect((JSON.parse(text) as { maxOutputTokens: number }).maxOutputTokens).toBe(4096)
  })
  it('finds the correct round after restart without allowing session IDs to select a filesystem path', async () => {
    const dir = await root()
    const report = vi.fn()
    const store = new DesktopDiagnostics(dir, report)
    const first = store.begin('../../outside', { prompt: 'first' })
    store.record('../../outside', 'session-update', { update: { messageId: 'first-message' } })
    await store.finish('../../outside', first, 'completed', {})
    const second = store.begin('../../outside', { prompt: 'second' })
    store.record('../../outside', 'session-update', { update: { messageId: 'second-message' } })
    store.record('../../outside', 'session-update', { update: { _meta: { harnessDiagnostics: {
      kind: 'session-event', data: { type: 'assistant/message', data: { message: { id: 'durable-assistant' } } },
    } } } })
    expect(await store.find('../../outside', 'first-message')).toBe(first.path)
    await store.finish('../../outside', second, 'failed', { error: new Error('EACCES') })
    const restarted = new DesktopDiagnostics(dir, report)
    expect(await restarted.find('../../outside', 'second-message')).toBe(second.path)
    expect(await restarted.find('../../outside', 'durable-assistant')).toBe(second.path)
    expect(first.path.startsWith(dir + '/')).toBe(true)
    expect((await stat(first.path)).mode & 0o777).toBe(0o600)
    expect(report).not.toHaveBeenCalled()
  })

  it('persists waiting for permission as inactivity rather than inferred task failure', async () => {
    const dir = await root()
    vi.useFakeTimers()
    const log = new DesktopTurnLog(join(dir, 'turn.jsonl'), vi.fn())
    log.setPhase('waiting-permission')
    await vi.advanceTimersByTimeAsync(60_000)
    await log.finish('completed', {})
    const records = (await readFile(log.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { kind: string; data: unknown })
    const inactivity = records.filter(record => record.kind === 'inactivity')
    expect(inactivity).toHaveLength(1)
    expect(inactivity[0]?.data).toMatchObject({ phase: 'waiting-permission', idleMs: 60_000 })
    expect(records.at(-1)?.kind).toBe('completed')
  })

  it('retains error stacks while redacting credential fields, bearer tokens, and binary image data', () => {
    const json = diagnosticJson({ apiKey: 'credential', headers: { Authorization: 'Bearer key' },
      error: new Error('EACCES tool rejected'), text: 'API_KEY=hidden Bearer hidden2', data: 'x'.repeat(5000) })
    expect(json).not.toContain('credential')
    expect(json).not.toContain('hidden')
    expect(json).not.toContain('Bearer key')
    expect(json).toContain('EACCES tool rejected')
    expect(json).toContain('stack')
    expect(json).toContain('[binary omitted]')
  })

  it('reports overflow and truncation explicitly and never rejects task settlement on disk failure', async () => {
    const dir = await root()
    const report = vi.fn()
    const log = new DesktopTurnLog(join(dir, 'turn.jsonl'), report)
    log.record('large', { text: 'x'.repeat(2 * 1024 * 1024) })
    for (let i = 0; i < 40; i += 1) log.record('chunk', { text: 'x'.repeat(300_000) })
    await log.finish('completed', {})
    const contents = await readFile(log.path, 'utf8')
    expect(contents).toContain('"truncated":true')
    expect(contents).toContain('"kind":"diagnostic-loss"')
    expect(Buffer.byteLength(contents)).toBeLessThan(9 * 1024 * 1024)
    await writeFile(join(dir, 'blocked'), 'file')
    const broken = new DesktopTurnLog(join(dir, 'blocked', 'turn.jsonl'), report)
    await expect(broken.finish('failed', {})).resolves.toBeUndefined()
    await expect(broken.ready()).rejects.toThrow()
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('refuses concurrent request ownership and explains unavailable historical logs', async () => {
    const dir = await root()
    const store = new DesktopDiagnostics(dir, vi.fn())
    const log = store.begin('session', {})
    expect(() => store.begin('session', {})).toThrow('active request')
    await store.finish('session', log, 'completed', {})
    await expect(store.find('session', 'missing')).rejects.toThrow('日志不存在')
  })
})
