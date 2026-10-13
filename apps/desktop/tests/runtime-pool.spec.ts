import { describe, expect, it, vi } from 'vitest'
import { DesktopRuntimePool } from '../src/runtime/main/pool.ts'
import type { StoredModelSettings } from '../src/desktop-model-storage.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function mockRuntime(model: string, next: () => string) {
  return { model, attachWindow: vi.fn(), running: () => true, start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []), createSession: vi.fn(async () => next()),
    loadSession: vi.fn(async () => {}), prepareSession: vi.fn(async (id: string) => id),
    prompt: vi.fn(async () => ({ stopReason: 'end_turn', artifacts: [] as [] })), cancel: vi.fn(), closeSession: vi.fn(async () => {}),
  }
}
function setup() {
  let settings: StoredModelSettings = { version: 4, id: 'one', model: 'one', baseURL: 'https://gateway.test/v1', protocol: 'openai-completions', encryptedApiKey: 'encrypted', computerUseEnabled: false, capabilities: { input: ['text'], verified: true, contextWindow: 32768 } }
  const instances: Array<ReturnType<typeof mockRuntime>> = []
  let counter = 0
  const transfer = vi.fn()
  const pool = new DesktopRuntimePool(async () => settings, (snapshot) => {
    const runtime = mockRuntime(snapshot!.model, () => `session-${++counter}`)
    instances.push(runtime); return runtime
  }, () => '/workspace', transfer)
  return { pool, instances, transfer, select: (model: string) => { settings = { ...settings, id: model, model } } }
}
describe('enterprise-aware Runtime revisions', () => {
  it('starts and reuses the default composition before any model profile is configured', async () => {
    const runtime = mockRuntime('default', () => 'empty')
    const create = vi.fn(() => runtime)
    const pool = new DesktopRuntimePool(async () => undefined, create, () => '/workspace', () => {})
    await pool.start(); await pool.listSessions()
    expect(create).toHaveBeenCalledOnce()
    expect(runtime.start).toHaveBeenCalledOnce()
    await pool.stop()
  })
  it('retains cancellation while an empty session is being prepared with a replacement identity', async () => {
    const { pool, instances } = setup()
    const id = await pool.createSession()
    const pending = deferred<string>()
    instances[0]!.prepareSession.mockReturnValueOnce(pending.promise)
    const prepared = pool.prepareSession(id)
    await vi.waitFor(() => { expect(instances[0]!.prepareSession).toHaveBeenCalled() })
    pool.cancel(id)
    pending.resolve('replacement')
    const next = await prepared
    expect((await pool.prompt(next, [{ type: 'text', text: 'cancelled' }])).stopReason).toBe('cancelled')
    expect(instances[0]!.prompt).not.toHaveBeenCalled()
    await pool.stop()
  })
  it('keeps an active old model and routes cancellation to it while new requests select another model', async () => {
    const { pool, instances, select } = setup()
    const id = await pool.createSession(); await pool.prepareSession(id)
    const result = deferred<{ stopReason: string; artifacts: [] }>()
    vi.mocked(instances[0]!.prompt).mockReturnValueOnce(result.promise)
    const running = pool.prompt(id, [{ type: 'text', text: 'first' }])
    select('two')
    const second = await pool.createSession(); await pool.prepareSession(second)
    await pool.prompt(second, [{ type: 'text', text: 'second' }])
    expect(instances.map(runtime => runtime.model)).toEqual(['one', 'two'])
    expect(instances[0]!.stop).not.toHaveBeenCalled()
    pool.cancel(id)
    expect(instances[0]!.cancel).toHaveBeenCalledWith(id)
    expect(instances[1]!.cancel).not.toHaveBeenCalled()
    result.resolve({ stopReason: 'cancelled', artifacts: [] }); await running
    expect(instances[0]!.stop).toHaveBeenCalledOnce()
    await pool.stop()
  })
  it('rebuilds an unsubmitted session and transfers its draft instead of loading nonexistent history', async () => {
    const { pool, instances, select, transfer } = setup()
    const old = await pool.createSession(); select('two')
    const next = await pool.prepareSession(old)
    expect(next).not.toBe(old)
    expect(instances[1]!.loadSession).not.toHaveBeenCalled()
    expect(transfer).toHaveBeenCalledWith(old, next)
    await pool.prompt(next, [{ type: 'text', text: 'first' }]); await pool.stop()
  })
  it('pins preparation so a simultaneous model selection cannot load an empty session in a different process', async () => {
    const { pool, instances, select } = setup()
    const id = await pool.createSession(); await pool.prepareSession(id)
    select('two'); await pool.start()
    await pool.prompt(id, [{ type: 'text', text: 'prepared' }])
    expect(instances[0]!.prompt).toHaveBeenCalledWith(id, expect.any(Array))
    expect(instances[1]!.loadSession).not.toHaveBeenCalled()
    await pool.stop()
  })
  it('rejects concurrent prompt/replay and revokes every instance on an enterprise change', async () => {
    const { pool, instances, select } = setup()
    const id = await pool.createSession(); await pool.prepareSession(id)
    const result = deferred<{ stopReason: string; artifacts: [] }>()
    vi.mocked(instances[0]!.prompt).mockReturnValueOnce(result.promise)
    const running = pool.prompt(id, [{ type: 'text', text: 'first' }])
    const rejected = expect(running).rejects.toThrow('已变更')
    await expect(pool.loadSession(id)).rejects.toThrow('任务正在运行')
    await expect(pool.prompt(id, [{ type: 'text', text: 'duplicate' }])).rejects.toThrow('操作正在运行')
    select('two'); await pool.start(); await pool.invalidate(true)
    expect(instances.every(runtime => vi.mocked(runtime.stop).mock.calls.length === 1)).toBe(true)
    result.resolve({ stopReason: 'end_turn', artifacts: [] }); await rejected
    await pool.stop()
  })
  it('rejects settings acquired before identity invalidation and creates no stale process', async () => {
    const pending = deferred<StoredModelSettings | undefined>()
    const create = vi.fn()
    const pool = new DesktopRuntimePool(() => pending.promise, create, () => '/workspace', () => {})
    const starting = pool.start(); const rejected = expect(starting).rejects.toThrow('已变更')
    await Promise.resolve(); await Promise.resolve()
    const invalidating = pool.invalidate(true); pending.resolve(undefined)
    await rejected; await invalidating
    expect(create).not.toHaveBeenCalled(); await pool.stop()
  })
})
