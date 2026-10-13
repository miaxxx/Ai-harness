import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ root: '', decrypt: vi.fn((value: Buffer) => value.toString()) }))
vi.mock('electron', () => ({ app: { getPath: () => native.root }, safeStorage: {
  isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: native.decrypt,
} }))
import { DesktopModelProfiles } from '../src/models/main/profiles.ts'

const profile = { version: 4, id: 'primary', baseURL: 'https://gateway.test/v1', model: 'one', protocol: 'openai-completions', encryptedApiKey: Buffer.from('test-secret').toString('base64'), computerUseEnabled: false,
  capabilities: { input: ['text'], verified: true, contextWindow: 32768, maxOutputTokens: 4096 } }
const child = { ...profile, model: 'child' }
beforeEach(async () => {
  native.root = await mkdtemp(join(tmpdir(), 'orbis-model-profiles-'))
  native.decrypt.mockClear()
  await writeFile(join(native.root, 'model-profiles.json'), JSON.stringify({ version: 1, defaultId: 'primary', profiles: [profile] }))
})
afterEach(async () => { vi.unstubAllGlobals(); await rm(native.root, { recursive: true, force: true }) })
describe('encrypted model profiles', () => {
  it.each(['save', 'inspect'] as const)('rejects cross-endpoint implicit key reuse on %s before network access', async (method) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const manager = new DesktopModelProfiles()
    await expect(manager[method]({ ...profile, baseURL: 'https://different.test/v1', apiKey: '' })).rejects.toThrow('对应 API Key')
    expect(native.decrypt).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect((await manager.read())?.baseURL).toBe(profile.baseURL)
  })
  it('rejects subagent endpoint changes with a blank key before probing either model', async () => {
    await writeFile(join(native.root, 'model-profiles.json'), JSON.stringify({ version: 1, defaultId: 'primary', profiles: [{ ...profile, subagent: child }] }))
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(new DesktopModelProfiles().save({ ...profile, apiKey: '', subagent: { ...child, baseURL: 'https://other.test/v1', apiKey: '' } })).rejects.toThrow('对应 API Key')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rechecks both unchanged endpoints and persists refreshed child capacity', async () => {
    await writeFile(join(native.root, 'model-profiles.json'), JSON.stringify({ version: 1, defaultId: 'primary', profiles: [{ ...profile, subagent: child }] }))
    const probes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'one', context_window: 65536 }, { id: 'child', context_window: 131072 }] }))
      probes.push((JSON.parse(typeof init?.body === 'string' ? init.body : '') as { model: string }).model)
      return new Response('{}')
    }))
    const manager = new DesktopModelProfiles()
    const result = await manager.save({ ...profile, apiKey: '', recheck: true, subagent: { ...child, apiKey: '' } })
    expect(probes).toContain('one'); expect(probes).toContain('child')
    expect(result.subagent?.capabilities.contextWindow).toBe(131072)
    expect(JSON.stringify(await manager.list())).not.toMatch(/test-secret|encryptedApiKey/)
  })
  it('keeps the working configuration when verification is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    const manager = new DesktopModelProfiles()
    await expect(manager.save({ ...profile, apiKey: '', model: 'denied' })).rejects.toThrow('403')
    expect((await manager.read())?.model).toBe('one')
  })
  it('selects/removes profiles atomically and imports only the old model record', async () => {
    const manager = new DesktopModelProfiles()
    await manager.select('primary'); await manager.remove('primary')
    expect(await manager.list()).toEqual({ profiles: [] })
    await rm(join(native.root, 'model-profiles.json'))
    await writeFile(join(native.root, 'primary-model.json'), JSON.stringify({ ...profile, version: 3 }))
    expect((await manager.read())?.overrides).toEqual({ contextWindow: 32768, maxOutputTokens: 4096 })
    expect((JSON.parse(await readFile(join(native.root, 'primary-model.json'), 'utf8')) as { version: number }).version).toBe(3)
  })
})
