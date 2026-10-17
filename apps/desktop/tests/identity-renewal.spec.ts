import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const native = vi.hoisted(() => {
  let start!: () => void
  const ready = new Promise<void>((resolve) => { start = resolve })
  return { directory: '', synchronize: vi.fn(), ready, start,
    handlers: new Map<string, (...args: unknown[]) => unknown>() }
})
vi.mock('electron', () => ({
  app: { getPath: () => native.directory, whenReady: () => native.ready, getVersion: () => '0.1.0' },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => { native.handlers.set(name, handler) } },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('../src/desktop-business-window.ts', () => ({
  configureBusinessIdentity: vi.fn(), clearBusinessIdentity: vi.fn(), refreshBusinessIdentity: native.synchronize,
}))
import { desktopObisAccess } from '../src/desktop-obis-identity-main.ts'

const requestURL = (input: string | URL | Request): string => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

it('shares native renewal and waits for the linked Web session before releasing credentials to consumers', async () => {
  native.directory = await mkdtemp(join(tmpdir(), 'desktop-identity-renewal-'))
  const path = join(native.directory, 'obis-enterprise.json')
  const previous = { version: 1, baseURL: 'https://api.example.test', businessWebURL: 'https://app.example.test/',
    tenantId: 'tenant', deviceId: 'device', installationId: 'installation',
    encryptedAccessToken: Buffer.from('old-access').toString('base64'), encryptedRefreshToken: Buffer.from('refresh').toString('base64'),
    expiresAt: new Date(0).toISOString() }
  await writeFile(path, JSON.stringify(previous))
  let releaseWeb!: () => void
  const webReady = new Promise<void>((resolve) => { releaseWeb = resolve })
  native.synchronize.mockImplementation(async () => { await webReady })
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const target = requestURL(url)
    let body: unknown
    if (target.endsWith('/v1/auth/refresh')) body = { sessionId: 'session-new', accessToken: 'new-access', refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 900_000).toISOString(), refreshExpiresAt: '2099-01-01T00:00:00Z' }
    else if (target.endsWith('/v1/me')) body = { user: { id: 'user', displayName: 'Employee' },
      membership: { tenantId: 'tenant', roles: ['employee'], status: 'active' } }
    else if (target.endsWith('/heartbeat')) body = { installation: { id: 'installation', deviceId: 'device', status: 'online' } }
    else throw new Error('Unexpected identity route')
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    const readers = [desktopObisAccess(), desktopObisAccess(), desktopObisAccess()]
    await vi.waitFor(() => { expect(native.synchronize).toHaveBeenCalledOnce() })
    let fourthReleased = false
    const fourth = desktopObisAccess().then((value) => { fourthReleased = true; return value })
    await Promise.resolve()
    expect(fourthReleased).toBe(false)
    releaseWeb()
    const results = await Promise.all([...readers, fourth])
    expect(results.every(item => item.accessToken === 'new-access')).toBe(true)
    expect(fetchMock.mock.calls.filter(([url]) => requestURL(url).endsWith('/v1/auth/refresh'))).toHaveLength(1)
    const stored = JSON.parse(await readFile(path, 'utf8')) as { businessWebURL: string }
    expect(stored.businessWebURL).toBe(previous.businessWebURL)
    await desktopObisAccess()
    expect(fetchMock.mock.calls.filter(([url]) => requestURL(url).endsWith('/v1/auth/refresh'))).toHaveLength(1)
    const active = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    await writeFile(path, JSON.stringify({ ...active, expiresAt: new Date(0).toISOString() }))
    const denied = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Session revoked' } }), { status: 401 }))
    vi.stubGlobal('fetch', denied)
    const refusals = await Promise.allSettled([desktopObisAccess(), desktopObisAccess()])
    expect(refusals.every(result => result.status === 'rejected')).toBe(true)
    expect(denied).toHaveBeenCalledOnce()
    const cleared = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(cleared['encryptedRefreshToken']).toBeUndefined()
    expect(cleared['businessWebURL']).toBe(previous.businessWebURL)
    await writeFile(path, JSON.stringify({ ...previous, expiresAt: '2099-01-01T00:00:00Z' }))
    native.start()
    await vi.waitFor(() => { expect(native.handlers.has('dsh:obis-identity-logout')).toBe(true) })
    let completeLogout!: () => void
    const logoutReady = new Promise<void>((resolve) => { completeLogout = resolve })
    const logoutFetch = vi.fn(async () => { await logoutReady; return new Response('{}', { status: 200 }) })
    vi.stubGlobal('fetch', logoutFetch)
    const logout = native.handlers.get('dsh:obis-identity-logout')
    if (!logout) throw new Error('Identity logout was not installed')
    const signingOut = logout({ senderFrame: { url: 'dsh-app://app/index.html' } })
    await vi.waitFor(() => { expect(logoutFetch).toHaveBeenCalledOnce() })
    await expect(desktopObisAccess()).rejects.toThrow('正在退出企业')
    completeLogout()
    await signingOut
    const loggedOut = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(loggedOut['encryptedAccessToken']).toBeUndefined()
  } finally { releaseWeb(); await rm(native.directory, { recursive: true }); vi.unstubAllGlobals(); vi.unstubAllEnvs() }
})
