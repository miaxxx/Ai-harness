import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopModelManager, type DesktopModelManagerHost } from '../src/models/main/manager.ts'
import type { StoredModelSettings } from '../src/desktop-model-storage.ts'

afterEach(() => vi.unstubAllGlobals())
const original: StoredModelSettings = { version: 3, baseURL: 'https://example.test/v1', model: 'one', protocol: 'openai-completions', encryptedApiKey: 'encrypted', computerUseEnabled: false, capabilities: { input: ['text'], verified: true } }
function setup() {
  let stored = original
  const host: DesktopModelManagerHost = {
    read: vi.fn(async () => stored), write: vi.fn(async (value: StoredModelSettings) => { stored = value }),
    validate: vi.fn(value => ({ stored: { ...stored, model: (value as { model: string }).model }, apiKey: 'secret' })),
    decrypt: vi.fn(() => 'secret'), restart: vi.fn(async () => {}), active: vi.fn(() => false),
  }
  return { host, manager: new DesktopModelManager(host), read: () => stored }
}
function directory(): Response { return new Response(JSON.stringify({ data: [{ id: 'one' }, { id: 'two' }] })) }
function baseline(): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
}

describe('Desktop model switching', () => {
  it('verifies the selected model before persisting and restarting', async () => {
    const { manager, host, read } = setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(directory()).mockResolvedValueOnce(baseline())
      .mockResolvedValueOnce(baseline()).mockResolvedValueOnce(directory())
    vi.stubGlobal('fetch', fetchMock)
    await manager.select('two')
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toMatchObject({ model: 'two' })
    expect(read().model).toBe('two')
    expect(host.restart).toHaveBeenCalledOnce()
    expect(manager.changing).toBe(false)
  })
  it('retains the working configuration when inference access is denied', async () => {
    const { manager, host, read } = setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(directory()).mockResolvedValueOnce(new Response('{}', { status: 403 })))
    await expect(manager.select('two')).rejects.toThrow('403')
    expect(read()).toBe(original)
    expect(host.write).not.toHaveBeenCalled()
    expect(host.restart).not.toHaveBeenCalled()
  })
  it('restores the previous model when runtime reconnection fails', async () => {
    const { manager, host, read } = setup()
    vi.mocked(host.restart).mockRejectedValueOnce(new Error('restart failed'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(directory()).mockResolvedValueOnce(baseline()).mockResolvedValueOnce(baseline()).mockResolvedValueOnce(directory()))
    await expect(manager.select('two')).rejects.toThrow('restart failed')
    expect(read()).toBe(original)
    expect(host.restart).toHaveBeenCalledTimes(2)
  })
  it('blocks changes during active replies', async () => {
    const { manager, host } = setup()
    vi.mocked(host.active).mockReturnValue(true)
    await expect(manager.select('two')).rejects.toThrow('回复完成')
    expect(host.read).not.toHaveBeenCalled()
  })
  it('never reuses a stored key for a different draft endpoint', async () => {
    const { manager, host } = setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(manager.discover({ baseURL: 'https://different.test/v1', apiKey: '', model: 'two' })).rejects.toThrow('对应 API Key')
    expect(host.decrypt).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
