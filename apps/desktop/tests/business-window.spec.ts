import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>, urls: [] as string[], visible: false, documentUrl: '',
  listeners: new Map<string, (event: { preventDefault(): void }, url: string) => void>(),
  load: vi.fn(async (_url: string) => {}), route: vi.fn(async () => false),
  cookie: vi.fn(), remove: vi.fn(), close: vi.fn(),
}))
vi.mock('electron', () => ({
  session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn(), cookies: { set: state.cookie, remove: state.remove } }) },
  WebContentsView: class {
    webContents = { setWindowOpenHandler: vi.fn(), isDestroyed: () => false, close: state.close,
      on: (name: string, listener: (event: { preventDefault(): void }, url: string) => void) => { state.listeners.set(name, listener) },
      executeJavaScript: state.route, getURL: () => state.documentUrl,
      loadURL: async (url: string) => { state.urls.push(url); await state.load(url); state.documentUrl = url }, insertCSS: vi.fn(),
    }
    constructor(options: Record<string, unknown>) { state.options.push(options) }
    setBackgroundColor() { /* Matches the server workspace background. */ }
    setBounds() { /* Geometry is validated before Electron receives it. */ }
    setVisible(value: boolean) { state.visible = value }
  },
}))
import { attachBusinessHost, clearBusinessIdentity, configureBusinessIdentity, refreshBusinessIdentity, hideBusinessPage, openBusinessWindow, setBusinessBounds } from '../src/desktop-business-window.ts'

describe('shared Next business workspace', () => {
  it('rejects insecure and credential-bearing origins before issuing credentials', async () => {
    for (const value of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path']) {
      vi.stubEnv('DSH_DESKTOP_BUSINESS_WEB_URL', value)
      await expect(openBusinessWindow()).rejects.toThrow()
    }
    expect(state.options).toHaveLength(0)
  })
  it('uses an isolated child view and an HttpOnly source-bound cookie in the existing window', async () => {
    vi.stubEnv('DSH_DESKTOP_BUSINESS_WEB_URL', 'https://app.example.com')
    attachBusinessHost({ on: vi.fn(), isDestroyed: () => false,
      getContentBounds: () => ({ width: 1280, height: 820 }), contentView: { addChildView: vi.fn() },
    } as never)
    expect(() =>{  setBusinessBounds({ x: 200, y: 0, width: 2000, height: 800 }) }).toThrow('尺寸无效')
    setBusinessBounds({ x: 300, y: 40, width: 980, height: 780 })
    const issue = vi.fn(async () => ({ sessionToken: 'opaque-test', expiresAt: '2027-01-01T00:00:00Z' }))
    configureBusinessIdentity(issue)
    await openBusinessWindow('knowledge')
    expect(state.route).not.toHaveBeenCalled()
    await openBusinessWindow('applications', { projectId: 'procurement', environmentId: 'test', moduleId: 'supplier/risk', pageId: 'home' })
    expect(issue).toHaveBeenCalledTimes(1)
    expect(state.cookie).toHaveBeenCalledTimes(1)
    expect(state.options).toHaveLength(1)
    expect(state.options[0]?.['webPreferences']).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true })
    expect(state.options[0]?.['webPreferences']).not.toHaveProperty('preload')
    expect(state.cookie).toHaveBeenCalledWith(expect.objectContaining({ name: '__Host-obis_web', value: 'opaque-test', httpOnly: true, secure: true, sameSite: 'lax' }))
    expect(state.urls).toEqual(['https://app.example.com/workspace/knowledge', 'https://app.example.com/workspace/apps/supplier%2Frisk/home?projectId=procurement&environmentId=test'])
    const preventDefault = vi.fn()
    state.listeners.get('will-navigate')?.({ preventDefault }, 'https://other.example.com')
    state.listeners.get('will-redirect')?.({ preventDefault }, 'https://other.example.com')
    expect(preventDefault).toHaveBeenCalledTimes(2)
    const navigationCount = state.urls.length
    await refreshBusinessIdentity(async () => ({ sessionToken: 'rotated-opaque', expiresAt: '2027-01-01T00:00:00Z' }))
    expect(state.cookie).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'rotated-opaque', httpOnly: true }))
    expect(state.urls).toHaveLength(navigationCount)
    expect(state.visible).toBe(true)
    hideBusinessPage()
    expect(state.visible).toBe(false)
    await clearBusinessIdentity()
    expect(state.remove).toHaveBeenCalledWith('https://app.example.com', '__Host-obis_web')
  })
  it('renews an expired linked session before accepting another route', async () => {
    const issue = vi.fn(async () => ({ sessionToken: 'renewed', expiresAt: '2027-01-01T00:00:00Z' }))
    configureBusinessIdentity(issue)
    await openBusinessWindow('spaces')
    await refreshBusinessIdentity(async () => ({ sessionToken: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() }))
    await openBusinessWindow('knowledge')
    expect(issue).toHaveBeenCalledTimes(2)
    expect(state.cookie).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'renewed' }))
  })
  it('ignores superseded load cancellation while preserving the newest page', async () => {
    let rejectOld!: (reason: Error) => void
    const started = new Promise<void>((resolve) => {
      state.load.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; resolve() }))
    })
    const older = openBusinessWindow('spaces')
    await started
    expect(state.visible).toBe(true)
    await openBusinessWindow('knowledge')
    rejectOld(new Error('ERR_ABORTED (-3)'))
    await expect(older).resolves.toBeUndefined()
    expect(state.visible).toBe(true)
    expect(state.urls.at(-1)).toBe('https://app.example.com/workspace/knowledge')
    state.load.mockRejectedValueOnce(new Error('connection refused'))
    await expect(openBusinessWindow('applications')).rejects.toThrow('connection refused')
  })
  it('keeps the business view visible and uses Next navigation when the document accepts it', async () => {
    state.route.mockResolvedValueOnce(true)
    const count = state.urls.length
    await openBusinessWindow('spaces')
    expect(state.visible).toBe(true)
    expect(state.urls).toHaveLength(count)
    expect(state.route).toHaveBeenLastCalledWith(expect.stringContaining('/workspace/spaces'))
  })
  it('does not reopen a business page when logout happens while credentials are being issued', async () => {
    await clearBusinessIdentity()
    let deliver!: (value: { sessionToken: string; expiresAt: string }) => void
    configureBusinessIdentity(() => new Promise((resolve) => { deliver = resolve }))
    const pending = openBusinessWindow('spaces')
    await clearBusinessIdentity()
    deliver({ sessionToken: 'stale', expiresAt: '2027-01-01T00:00:00Z' })
    await pending
    expect(state.cookie).not.toHaveBeenCalledWith(expect.objectContaining({ value: 'stale' }))
    expect(state.visible).toBe(false)
    vi.unstubAllEnvs()
  })
})
