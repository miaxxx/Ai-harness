/** Sandboxed Next.js pages share the native conversation window without its preload. */
import { WebContentsView, session } from 'electron'
import type { BrowserWindow, Rectangle } from 'electron'
import type { DesktopApplicationPageRequest, DesktopBusinessEntry } from './desktop-application-shared.ts'

let host: BrowserWindow | undefined
let view: WebContentsView | undefined
let bounds: Rectangle | undefined
let generation = 0
let cookieOperations: Promise<void> = Promise.resolve()

function mutateCookie(operation: () => Promise<void>): Promise<void> {
  const result = cookieOperations.then(operation, operation)
  // Callers receive failures; a rejected mutation must not block later logout cleanup.
  cookieOperations = result.catch(() => {})
  return result
}
type BusinessSession = { sessionToken: string; expiresAt: string }
let linkedSession: BusinessSession | undefined
let identityProvider: ((previous?: BusinessSession) => Promise<BusinessSession>) | undefined

/**
 * Supply a source-bound Web session from the native credential owner.
 * @param provider Returns an opaque cookie; bearer credentials remain in Main.
 */
export function configureBusinessIdentity(provider: (previous?: BusinessSession) => Promise<BusinessSession>): void {
  identityProvider = provider
}

/**
 * Bind business pages to the application's existing native window.
 * @param window Native local UI owner.
 */
export function attachBusinessHost(window: BrowserWindow): void {
  host = window
  window.on('closed', () => {
    generation++
    view?.webContents.close()
    view = undefined
    host = undefined
    bounds = undefined
  })
}

/**
 * Apply geometry measured by the trusted local layout.
 * @param rectangle Right-hand workspace bounds, in window content pixels.
 */
export function setBusinessBounds(rectangle: Rectangle): void {
  if (!host || host.isDestroyed()) throw new Error('业务工作区尚未就绪。')
  const size = host.getContentBounds()
  if (![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isSafeInteger)
    || rectangle.x < 0 || rectangle.y < 0 || rectangle.width < 1 || rectangle.height < 1
    || rectangle.x + rectangle.width > size.width || rectangle.y + rectangle.height > size.height) {
    throw new Error('业务工作区尺寸无效。')
  }
  bounds = rectangle
  view?.setBounds(rectangle)
}

/** Restore the mounted conversation without destroying its session. */
export function hideBusinessPage(): void {
  generation++
  view?.setVisible(false)
}

/** Clear the linked browser cookie and hide business pages on identity changes. */
export async function clearBusinessIdentity(): Promise<void> {
  hideBusinessPage()
  linkedSession = undefined
  const raw = process.env.DSH_DESKTOP_BUSINESS_WEB_URL?.trim()
  if (raw) await mutateCookie(() => session.fromPartition('persist:obis-business').cookies.remove(new URL(raw).origin, '__Host-obis_web'))
}

/**
 * Renew the linked Cookie after native credentials rotate without reloading the page.
 * @param issue Returns a Web session issued from the newly stored human credentials.
 */
export async function refreshBusinessIdentity(issue: () => Promise<BusinessSession>): Promise<void> {
  if (!linkedSession) return
  const revision = generation
  const issued = await issue()
  if (revision !== generation) return
  const raw = process.env.DSH_DESKTOP_BUSINESS_WEB_URL?.trim()
  if (!raw) throw new Error('业务工作台地址未配置。')
  linkedSession = issued
  await mutateCookie(async () => {
    if (revision !== generation) return
    await session.fromPartition('persist:obis-business').cookies.set({ url: new URL(raw).origin,
      name: '__Host-obis_web', value: issued.sessionToken, path: '/', secure: true, httpOnly: true,
      sameSite: 'lax', expirationDate: Date.parse(issued.expiresAt) / 1000 })
  })
}

/**
 * Render a fixed business entry inside the shared right workspace.
 * @param entry Fixed route; callers cannot supply an arbitrary URL.
 * @param page Optional Module page already authorized by the native API owner.
 * @param reveal Whether to show the page; false prepares the first entry behind chat.
 * @returns Resolves when Next accepts the route, or the initial document finishes loading.
 */
export async function openBusinessWindow(entry: DesktopBusinessEntry = 'applications', page?: DesktopApplicationPageRequest, reveal = true): Promise<void> {
  const raw = process.env.DSH_DESKTOP_BUSINESS_WEB_URL?.trim()
  if (!raw) throw new Error('请配置 DSH_DESKTOP_BUSINESS_WEB_URL 后打开业务工作台。')
  const base = new URL(raw)
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('业务工作台地址必须是网站根地址。')
  if (base.protocol !== 'https:') throw new Error('业务工作台必须使用 HTTPS。')
  if (!host || host.isDestroyed() || !bounds) throw new Error('请先选择客户端中的业务工作区。')
  if (!identityProvider) throw new Error('业务身份尚未就绪。')
  const started = performance.now()
  const revision = ++generation
  const issued = linkedSession && Date.parse(linkedSession.expiresAt) > Date.now()
    ? linkedSession : await identityProvider(linkedSession)
  if (revision !== generation) return
  const replaceCookie = issued !== linkedSession
  linkedSession = issued
  const businessSession = session.fromPartition('persist:obis-business')
  if (replaceCookie) await mutateCookie(async () => {
    if (revision !== generation) return
    await businessSession.cookies.set({ url: base.origin, name: '__Host-obis_web', value: issued.sessionToken,
      path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: Date.parse(issued.expiresAt) / 1000 })
  })
  if (revision !== generation) return
  if (!view || view.webContents.isDestroyed()) {
    businessSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    view = new WebContentsView({ webPreferences: {
      session: businessSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
    } })
    view.setVisible(false)
    view.setBackgroundColor('#f4f5f7')
    host.contentView.addChildView(view)
    const contents = view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, target) => { if (new URL(target).origin !== base.origin) event.preventDefault() })
    contents.on('will-redirect', (event, target) => { if (new URL(target).origin !== base.origin) event.preventDefault() })
    contents.on('did-navigate', (_event, target) => {
      if (new URL(target).pathname === '/sign-in') {
        void clearBusinessIdentity().then(() => { host?.webContents.send('dsh:business-session-ended') })
      }
    })
    contents.on('did-finish-load', () => {
      // The native sidebar owns navigation; Next still owns the complete business content.
      void contents.insertCSS('.shell { grid-template-columns: minmax(0, 1fr) !important; } .shell > .rail { display: none !important; }')
    })
  }
  const paths = { applications: '/workspace', spaces: '/workspace/spaces', knowledge: '/workspace/knowledge', builder: '/builder' }
  const target = page
    ? `/workspace/apps/${encodeURIComponent(page.moduleId)}/${encodeURIComponent(page.pageId)}?${new URLSearchParams({ projectId: page.projectId, environmentId: page.environmentId })}`
    : paths[entry]
  view.setBounds(bounds)
  if (reveal) view.setVisible(true)
  try {
    const routed = view.webContents.getURL().startsWith(base.origin + '/')
      && await view.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('obis:navigate', { detail: ${JSON.stringify(target)}, cancelable: true })) === false`)
    if (revision !== generation) return
    if (!routed) await view.webContents.loadURL(new URL(target, base).href)
  } catch (error) {
    // A newer navigation or chat selection owns the view after cancellation.
    if (revision !== generation) return
    throw error
  }
  if (revision === generation && reveal) view.setVisible(true)
  console.info('[desktop-business] navigation accepted', Math.round(performance.now() - started), 'ms')
}
