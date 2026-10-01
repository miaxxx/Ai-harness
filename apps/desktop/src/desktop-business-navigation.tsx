/** OBIS navigation occupies shared sidebar slots beside the original chat browser. */
import { useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SidebarSettingsOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { DesktopApplicationNavigationRecord, DesktopBusinessEntry } from './desktop-application-shared.ts'
import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import { seedBusinessReferenceCatalog } from './desktop-business-references.ts'
import css from './desktop-business-navigation.module.css'

interface NavigationProps extends SidebarSettingsOwnerProps {
  scope: DesktopEnterpriseScopeRequest
  modules: DesktopApplicationNavigationRecord[]
  tenantName: string
}

async function reportWorkspaceBounds(): Promise<void> {
  const center = document.querySelector('[data-shell-center]')
  if (!center) throw new Error('对话工作区尚未就绪。')
  const rect = center.getBoundingClientRect()
  await window.dshBusiness.setBounds({ x: Math.ceil(rect.x), y: Math.ceil(rect.y),
    width: Math.floor(rect.width), height: Math.floor(rect.height) })
}

function BusinessNavigation({ wide, scope, modules, tenantName }: NavigationProps) {
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState<string>()
  const [items, setItems] = useState(modules)
  const navigationRevision = useRef(0)
  useEffect(() => {
    void reportWorkspaceBounds().then(() => {
      if (navigationRevision.current === 0) return window.dshBusiness.prepare()
    }).catch((reason: unknown) => { console.warn('[desktop-business] background preparation failed:', reason) })
  }, [])
  const showChat = (): void => { navigationRevision.current++; setSelected(undefined); setError(undefined); void window.dshBusiness.hide() }
  useEffect(() => {
    const unsubscribe = window.dshBusiness.onSessionEnded(() => {
      showChat()
      setError('业务登录已失效，请重新打开业务入口；AI 对话会保留。')
    })
    const onChatNavigation = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-shell-chat-navigation]')) showChat()
    }
    document.addEventListener('click', onChatNavigation, true)
    const observer = new ResizeObserver(() => { if (selected) void reportWorkspaceBounds().catch(() => { showChat() }) })
    const center = document.querySelector('[data-shell-center]')
    if (center) observer.observe(center)
    return () => { document.removeEventListener('click', onChatNavigation, true); observer.disconnect(); unsubscribe() }
  }, [selected])
  const open = async (id: string, entry?: DesktopBusinessEntry, page?: DesktopApplicationNavigationRecord): Promise<void> => {
    const revision = ++navigationRevision.current
    setError(undefined)
    setSelected(id)
    try {
      await reportWorkspaceBounds()
      if (revision !== navigationRevision.current) return
      void window.dshApplications.navigation(scope).then((pages) => {
        seedBusinessReferenceCatalog(scope, pages)
        setItems(pages)
      }).catch(() => { /* Page access still checks authority when the directory refresh fails. */ })
      if (page) await window.dshBusiness.openPage({ ...scope, moduleId: page.moduleId, pageId: page.page })
      else if (entry) await window.dshBusiness.openEntry(entry)
    } catch (reason) {
      if (revision !== navigationRevision.current) return
      setSelected(undefined)
      void window.dshBusiness.hide()
      console.error('[desktop-business] page navigation failed:', reason)
      setError('业务页面暂时无法打开，请重试。你可以继续使用 AI 对话。')
    }
  }
  const entries: Array<[DesktopBusinessEntry, string, string]> = [
    ['applications', '业务应用', '▦'], ['spaces', '公共空间', '◇'], ['knowledge', '资料库', '▤'],
  ]
  return <nav className={css.navigation} aria-label="OBIS 工作区">
    {wide && <div className={css.heading}>{tenantName}</div>}
    <button className={css.item} onClick={showChat} aria-current={selected === undefined ? 'page' : undefined} title="AI 对话">
      <span aria-hidden>◌</span>{wide && <span>AI 对话</span>}
    </button>
    {entries.map(([id, label, icon]) => <button key={id} className={css.item} title={label}
      aria-current={selected === id ? 'page' : undefined} onClick={() => { void open(id, id) }}>
      <span aria-hidden>{icon}</span>{wide && <span>{label}</span>}
    </button>)}
    {items.map(page => <button key={page.id} className={css.item} title={page.label}
      aria-current={selected === page.id ? 'page' : undefined} onClick={() => { void open(page.id, undefined, page) }}>
      <span aria-hidden>▧</span>{wide && <span>{page.label}</span>}
    </button>)}
    {error && <p className={css.error} role="alert">{error}</p>}
  </nav>
}

/** Services used by the product navigation contribution. */
export const inject = ['slots', 'locale']

/**
 * Validate the selected enterprise scope and contribute OBIS entries to the shared sidebar.
 * @param ctx Client root; existing conversation and workspace plugins retain ownership.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const identity = await window.dshEnterprise.status()
  if (!identity.configured || !identity.authenticated) return
  const context = await window.dshEnterprise.context()
  const workspace = await window.dshEnterprise.workspace()
  const tenant = context.tenants.find(item => item.id === context.currentTenantId)
  const projectId = workspace.preferences.defaultProjectId ?? tenant?.projects[0]?.id
  const environmentId = workspace.preferences.defaultEnvironmentId ?? tenant?.environments.find(item => item.status === 'active')?.id
  if (!tenant || !projectId || !environmentId) throw new Error('请配置所属项目和可用环境。')
  const scope = { projectId, environmentId }
  await window.dshEnterprise.validateRuntimeScope(scope)
  await window.dshDesktop.restartRuntime()
  const modules = await window.dshApplications.navigation(scope)
  seedBusinessReferenceCatalog(scope, modules)
  ctx.locale.setLocale('zh')
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.footer.action', id: 'desktop.obis.identity',
    inject: () => ({ label: identity.user?.displayName ?? '企业用户' }) },
  ({ wide, label }: SidebarSettingsOwnerProps & { label: string }) => <button className={css.item} title={`${label} · 退出登录`}
    onClick={() => { void window.dshEnterprise.logout().finally(() => { window.location.reload() }) }}><span aria-hidden>◉</span>{wide && <span>{label} · 退出登录</span>}</button>), 'desktop: identity footer')
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.navigation', id: 'desktop.obis',
    inject: () => ({ scope, modules, tenantName: tenant.displayName }) }, BusinessNavigation), 'desktop: OBIS sidebar navigation')
}
