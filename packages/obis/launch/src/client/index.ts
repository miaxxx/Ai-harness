/** Browser companion for secure OBIS Workspace handoff.
 * The fragment carries only a one-time ticket. It is removed from history before
 * the Host RPC runs; delegated credentials never enter browser storage or JS state.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { renderSharedApplicationLayout, SHARED_RENDERER_STYLE } from './renderer.ts'

export const inject = ['connection']

/** Preview overlay persona copied from the launch-bound preview metadata. */
export type ApplicationPreviewPersona = 'employee' | 'manager' | 'auditor' | 'developer'

/** Launch-bound application preview identifiers persisted after Host exchange. */
export interface ApplicationPreviewLaunch {
  projectId: string
  previewId: string
  pageId: string
  persona: ApplicationPreviewPersona
}

/** Entitled published navigation row bound to the current launch's project and environment. */
export interface WorkspaceApplicationNavigationItem {
  id: string
  label: string
  page: string
  group?: string
  moduleId: string
  moduleVersion: string
}

/** Launch-bound entitled navigation returned by Host RPC `catalog`. */
export interface WorkspaceLaunchCatalog {
  projectId: string
  environmentId: string
  items: WorkspaceApplicationNavigationItem[]
}

/** Browser-safe exchange result: session id and expiry, never the delegated token. */
export interface SafeWorkspaceLaunchExchange {
  access: { sessionId: string; expiresAt: string }
  launch: {
    id: string
    tenantId: string
    userId: string
    environmentId: string
    projectId?: string
    harnessOrigin: string
    goal?: string
    autonomy: 'read-only' | 'recommend' | 'draft' | 'human-approved' | 'bounded-autonomous'
    preview?: ApplicationPreviewLaunch
    createdAt: string
    expiresAt: string
    consumedAt?: string
  }
}

const SESSION_KEY = 'dsh.obisLaunch'

function consumeTicketFromFragment(): string | undefined {
  if (typeof location === 'undefined' || !location.hash) return undefined
  const params = new URLSearchParams(location.hash.slice(1))
  const ticket = params.get('obis-launch')?.trim() || undefined
  if (ticket === undefined) return undefined

  params.delete('obis-launch')
  // Older OBIS launchers briefly emitted obis-base. The Host owns baseUrl now,
  // so strip this legacy value rather than trusting it.
  params.delete('obis-base')
  const nextHash = params.toString()
  const next = `${location.pathname}${location.search}${nextHash ? `#${nextHash}` : ''}`
  history.replaceState(history.state, '', next)
  return ticket
}

interface PreviewUiNode {
  component: string
  id?: string
  tokenRefs?: string[]
  props?: Record<string, unknown>
  children?: PreviewUiNode[]
}

interface PreviewPageEnvelope {
  preview: { id: string; moduleId: string; moduleVersion: string; sourceRevision: number; persona: ApplicationPreviewPersona }
  module: { id: string; version: string; name: string }
  page: { id: string; title: string; pattern?: string; layout: PreviewUiNode; actions?: string[] }
  designSystem: { id: string; version: string }
  access: {
    visible: boolean
    executable: boolean
    configurable: boolean
    editable: boolean
    administerable: boolean
    reasons: string[]
  }
}

interface PublishedPageEnvelope {
  module: { id: string; version: string; name: string }
  page: { id: string; title: string; pattern?: string; layout: PreviewUiNode; actions?: string[] }
  designSystem: { id: string; version: string }
  permissions: {
    visible: boolean
    executable: boolean
    configurable: boolean
    editable: boolean
    administerable: boolean
    reasons: string[]
  }
}

function previewRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function previewNode(value: unknown): PreviewUiNode | undefined {
  const row = previewRecord(value)
  if (!row || typeof row.component !== 'string' || !row.component.trim()) return undefined
  const children = Array.isArray(row.children)
    ? row.children.map(previewNode).filter((item): item is PreviewUiNode => item !== undefined)
    : undefined
  const props = previewRecord(row.props)
  const tokenRefs = Array.isArray(row.tokenRefs) && row.tokenRefs.every(item => typeof item === 'string')
    ? row.tokenRefs
    : undefined
  return {
    component: row.component.trim(),
    ...(typeof row.id === 'string' && row.id.trim() ? { id: row.id.trim() } : {}),
    ...(tokenRefs?.length ? { tokenRefs } : {}),
    ...(props ? { props } : {}),
    ...(children?.length ? { children } : {}),
  }
}

function parseAccess(value: unknown, label: string): PreviewPageEnvelope['access'] {
  const access = previewRecord(value)
  if (
    !access
    || typeof access.visible !== 'boolean' || typeof access.executable !== 'boolean'
    || typeof access.configurable !== 'boolean' || typeof access.editable !== 'boolean'
    || typeof access.administerable !== 'boolean'
    || !Array.isArray(access.reasons) || !access.reasons.every(item => typeof item === 'string')
  ) throw new Error(`${label} returned an invalid entitlement decision.`)
  return {
    visible: access.visible,
    executable: access.executable,
    configurable: access.configurable,
    editable: access.editable,
    administerable: access.administerable,
    reasons: access.reasons,
  }
}

function parsePageFields(page: Record<string, unknown> | undefined, layout: PreviewUiNode | undefined, label: string): PreviewPageEnvelope['page'] {
  if (!page || !layout || typeof page.id !== 'string' || typeof page.title !== 'string') {
    throw new Error(`${label} returned an invalid page envelope.`)
  }
  return {
    id: page.id,
    title: page.title,
    ...(typeof page.pattern === 'string' ? { pattern: page.pattern } : {}),
    layout,
    ...(Array.isArray(page.actions) && page.actions.every(item => typeof item === 'string') ? { actions: page.actions } : {}),
  }
}

function parseModuleAndDesign(
  module: Record<string, unknown> | undefined,
  designSystem: Record<string, unknown> | undefined,
  label: string,
): {
  module: PreviewPageEnvelope['module']
  designSystem: PreviewPageEnvelope['designSystem']
} {
  if (
    !module || !designSystem
    || typeof module.id !== 'string' || typeof module.version !== 'string' || typeof module.name !== 'string'
    || typeof designSystem.id !== 'string' || typeof designSystem.version !== 'string'
  ) throw new Error(`${label} returned an invalid page envelope.`)
  return {
    module: { id: module.id, version: module.version, name: module.name },
    designSystem: { id: designSystem.id, version: designSystem.version },
  }
}

function parsePreviewPage(value: unknown): PreviewPageEnvelope {
  const row = previewRecord(value)
  const preview = previewRecord(row?.preview)
  const persona = preview?.persona
  const layout = previewNode(previewRecord(row?.page)?.layout)
  if (
    !row || !preview
    || typeof preview.id !== 'string' || typeof preview.moduleId !== 'string' || typeof preview.moduleVersion !== 'string'
    || typeof preview.sourceRevision !== 'number'
    || (persona !== 'employee' && persona !== 'manager' && persona !== 'auditor' && persona !== 'developer')
  ) throw new Error('OBIS application preview returned an invalid page envelope.')
  const fields = parseModuleAndDesign(previewRecord(row.module), previewRecord(row.designSystem), 'OBIS application preview')
  return {
    preview: {
      id: preview.id,
      moduleId: preview.moduleId,
      moduleVersion: preview.moduleVersion,
      sourceRevision: preview.sourceRevision,
      persona,
    },
    module: fields.module,
    page: parsePageFields(previewRecord(row.page), layout, 'OBIS application preview'),
    designSystem: fields.designSystem,
    access: parseAccess(row.access, 'OBIS application preview'),
  }
}

function parsePublishedPage(value: unknown): PublishedPageEnvelope {
  const row = previewRecord(value)
  const layout = previewNode(previewRecord(row?.page)?.layout)
  const fields = parseModuleAndDesign(previewRecord(row?.module), previewRecord(row?.designSystem), 'OBIS application page')
  return {
    module: fields.module,
    page: parsePageFields(previewRecord(row?.page), layout, 'OBIS application page'),
    designSystem: fields.designSystem,
    permissions: parseAccess(row?.permissions, 'OBIS application page'),
  }
}

function parseCatalogItem(value: unknown): WorkspaceApplicationNavigationItem {
  const row = previewRecord(value)
  if (
    !row
    || typeof row.id !== 'string' || !row.id.trim()
    || typeof row.label !== 'string' || !row.label.trim()
    || typeof row.page !== 'string' || !row.page.trim()
    || typeof row.moduleId !== 'string' || !row.moduleId.trim()
    || typeof row.moduleVersion !== 'string' || !row.moduleVersion.trim()
  ) throw new Error('OBIS workspace catalog returned an invalid navigation item.')
  return {
    id: row.id.trim(),
    label: row.label.trim(),
    page: row.page.trim(),
    moduleId: row.moduleId.trim(),
    moduleVersion: row.moduleVersion.trim(),
    ...(typeof row.group === 'string' && row.group.trim() ? { group: row.group.trim() } : {}),
  }
}

function parseCatalog(value: unknown): WorkspaceLaunchCatalog {
  const row = previewRecord(value)
  if (
    !row
    || typeof row.projectId !== 'string' || !row.projectId.trim()
    || typeof row.environmentId !== 'string' || !row.environmentId.trim()
    || !Array.isArray(row.items)
  ) throw new Error('OBIS workspace catalog returned an invalid payload.')
  return {
    projectId: row.projectId.trim(),
    environmentId: row.environmentId.trim(),
    items: row.items.map(parseCatalogItem),
  }
}

function previewElement(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function renderPageLayout(envelope: { page: PreviewPageEnvelope['page']; designSystem: { id: string; version: string } }): HTMLElement {
  const canvas = previewElement('div', 'obis-preview-canvas')
  canvas.append(renderSharedApplicationLayout(envelope.page.layout, {
    ...(envelope.page.pattern ? { pattern: envelope.page.pattern } : {}),
    ...(envelope.page.actions ? { actions: envelope.page.actions } : {}),
    designSystem: envelope.designSystem,
  }))
  return canvas
}

function ensurePreviewStyle(): void {
  if (document.getElementById('obis-application-preview-style')) return
  const style = document.createElement('style')
  style.id = 'obis-application-preview-style'
  style.textContent = `
    .obis-preview-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,12,.72);display:grid;place-items:center;padding:24px;font-family:Inter,system-ui,sans-serif}
    .obis-preview-shell{width:min(1180px,100%);height:min(820px,100%);background:#f7f8fa;color:#16181d;border-radius:18px;overflow:hidden;display:grid;grid-template-rows:auto 1fr;box-shadow:0 28px 90px rgba(0,0,0,.34)}
    .obis-preview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:20px 24px;border-bottom:1px solid rgba(22,24,29,.12);background:white}
    .obis-preview-kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#68707d}.obis-preview-title{margin:4px 0 0;font-size:24px}.obis-preview-meta{margin:6px 0 0;font-size:12px;color:#68707d}
    .obis-preview-close{border:0;background:#eef0f3;border-radius:10px;width:36px;height:36px;font-size:20px;cursor:pointer}
    .obis-preview-body{overflow:auto;padding:24px}.obis-preview-notice{padding:12px 14px;margin-bottom:18px;border:1px solid rgba(22,24,29,.12);border-radius:12px;background:white;font-size:13px;color:#4e5663}
    .obis-preview-canvas{display:grid;gap:14px}.obis-preview-hidden{opacity:.58}
    .obis-catalog-list{display:grid;gap:10px}.obis-catalog-item{display:flex;justify-content:space-between;gap:16px;align-items:center;border:1px solid rgba(22,24,29,.12);border-radius:12px;background:white;padding:14px 16px;cursor:pointer;font:inherit;text-align:left}
    .obis-catalog-item small{color:#68707d}
  ` + SHARED_RENDERER_STYLE
  document.head.append(style)
}

function mountOverlay(input: {
  id: string
  hidden: boolean
  kicker: string
  title: string
  meta: string
  notice: string
  closeLabel: string
  body: HTMLElement
}): HTMLElement {
  document.getElementById(input.id)?.remove()
  ensurePreviewStyle()
  const backdrop = previewElement('div', 'obis-preview-backdrop')
  backdrop.id = input.id
  const shell = previewElement('article', 'obis-preview-shell')
  if (input.hidden) shell.classList.add('obis-preview-hidden')
  const head = previewElement('header', 'obis-preview-head')
  const copy = previewElement('div')
  const kicker = previewElement('div', 'obis-preview-kicker')
  kicker.textContent = input.kicker
  const title = previewElement('h1', 'obis-preview-title')
  title.textContent = input.title
  const meta = previewElement('p', 'obis-preview-meta')
  meta.textContent = input.meta
  copy.append(kicker, title, meta)
  const close = previewElement('button', 'obis-preview-close') as HTMLButtonElement
  close.type = 'button'
  close.setAttribute('aria-label', input.closeLabel)
  close.textContent = '×'
  close.onclick = () => { backdrop.remove() }
  head.append(copy, close)
  const body = previewElement('div', 'obis-preview-body')
  const notice = previewElement('div', 'obis-preview-notice')
  notice.textContent = input.notice
  body.append(notice, input.body)
  shell.append(head, body)
  backdrop.append(shell)
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove() }
  document.body.append(backdrop)
  return backdrop
}

function renderPreviewOverlay(envelope: PreviewPageEnvelope): void {
  const canvas = renderPageLayout(envelope)
  mountOverlay({
    id: 'obis-application-preview',
    hidden: !envelope.access.visible,
    kicker: `Immutable preview · ${envelope.preview.persona} · revision ${envelope.preview.sourceRevision}`,
    title: envelope.page.title,
    meta: `${envelope.module.name} · ${envelope.module.version} · ${envelope.designSystem.id}@${envelope.designSystem.version}`,
    notice: envelope.access.visible
      ? `Read-only preview. Production Query, Action, Approval and AI authority are disabled. Published executable entitlement would be ${String(envelope.access.executable)}.`
      : `This page is hidden for the simulated persona. ${envelope.access.reasons.join(' ')}`,
    closeLabel: 'Close application preview',
    body: canvas,
  })
}

function renderPublishedOverlay(envelope: PublishedPageEnvelope): void {
  document.getElementById('obis-application-catalog')?.remove()
  const canvas = renderPageLayout(envelope)
  mountOverlay({
    id: 'obis-application-page',
    hidden: !envelope.permissions.visible,
    kicker: 'Published entitled application',
    title: envelope.page.title,
    meta: `${envelope.module.name} · ${envelope.module.version} · ${envelope.designSystem.id}@${envelope.designSystem.version}`,
    notice: envelope.permissions.visible
      ? `Entitled catalog view. Query, Action, Approval and AI stay on OBIS Workspace; this overlay does not execute them. Executable entitlement is ${String(envelope.permissions.executable)}.`
      : `This page is hidden for the current identity. ${envelope.permissions.reasons.join(' ')}`,
    closeLabel: 'Close application page',
    body: canvas,
  })
}

function renderCatalogOverlay(
  catalog: WorkspaceLaunchCatalog,
  onOpen: (item: WorkspaceApplicationNavigationItem) => void,
): void {
  const list = previewElement('div', 'obis-catalog-list')
  if (catalog.items.length === 0) {
    const empty = previewElement('p', 'obis-preview-node-value')
    empty.textContent = 'No entitled published applications are visible in this launch scope.'
    list.append(empty)
  }
  for (const item of catalog.items) {
    const button = previewElement('button', 'obis-catalog-item') as HTMLButtonElement
    button.type = 'button'
    button.dataset.moduleId = item.moduleId
    button.dataset.pageId = item.page
    const copy = previewElement('div')
    const title = previewElement('strong')
    title.textContent = item.label
    const meta = previewElement('small')
    meta.textContent = `${item.moduleId} · ${item.page}${item.group ? ` · ${item.group}` : ''}`
    copy.append(title, meta)
    button.append(copy)
    button.onclick = () => { onOpen(item) }
    list.append(button)
  }
  mountOverlay({
    id: 'obis-application-catalog',
    hidden: false,
    kicker: 'Published module catalog',
    title: 'Entitled applications',
    meta: `${catalog.projectId} · ${catalog.environmentId} · ${String(catalog.items.length)} visible`,
    notice: 'Pages listed here come from Kernel navigation for this launch-bound project and environment. The Host refuses module or page identifiers that are not in this catalog.',
    closeLabel: 'Close application catalog',
    body: list,
  })
}

function persistSafeLaunch(value: unknown): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
  } catch {
    // Safe metadata persistence is an optimization for UI continuity; failure
    // must not block the already-established Host credential handoff.
  }
}

/**
 * Latest non-secret OBIS launch metadata saved by this browser tab.
 * @returns the persisted exchange, or undefined when sessionStorage is missing or empty
 */
export function readObisLaunch(): SafeWorkspaceLaunchExchange | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return undefined
  try { return JSON.parse(raw) as SafeWorkspaceLaunchExchange } catch { return undefined }
}

/**
 * Latest launch-bound preview metadata saved by this browser tab, if the launch was a preview.
 * @returns the preview identifiers, or undefined when the launch is not a preview
 */
export function readObisPreviewLaunch(): ApplicationPreviewLaunch | undefined {
  return readObisLaunch()?.launch.preview
}

function openPublishedPage(
  connection: ConnectionHandle,
  item: WorkspaceApplicationNavigationItem,
  catalog: WorkspaceLaunchCatalog,
): void {
  void connection.rpc.call('/obis-launch', 'module-page', { moduleId: item.moduleId, pageId: item.page }).then((pageResult) => {
    if (!pageResult.ok) throw new Error(pageResult.error.message)
    const page = parsePublishedPage(pageResult.value)
    if (page.module.id !== item.moduleId || page.page.id !== item.page) {
      throw new Error('OBIS application page response did not match the catalog item.')
    }
    renderPublishedOverlay(page)
    window.dispatchEvent(new CustomEvent('obis:application-page-ready', {
      detail: { item, catalog, page },
    }))
  }).catch((error: unknown) => {
    console.error('[obis-launch] published application page failed:', error)
    window.dispatchEvent(new CustomEvent('obis:application-page-failed', {
      detail: { message: error instanceof Error ? error.message : String(error) },
    }))
  })
}

/** Consume a one-time launch ticket from the URL fragment and overlay the launch-bound preview or published catalog. */
export function apply(ctx: Context): void {
  const ticket = consumeTicketFromFragment()
  if (ticket === undefined || typeof location === 'undefined') return
  const harnessOrigin = location.origin

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('OBIS launch requires the client connection service.')
  void connection.rpc.call('/obis-launch', 'exchange', { ticket, harnessOrigin }).then((result) => {
    if (!result.ok) throw new Error(result.error.message)
    const exchange = result.value as SafeWorkspaceLaunchExchange
    persistSafeLaunch(exchange)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('obis:launch-ready', { detail: exchange }))
      if (exchange.launch.preview) {
        const previewLaunch = exchange.launch.preview
        void connection.rpc.call('/obis-launch', 'preview-page', undefined).then((previewResult) => {
          if (!previewResult.ok) throw new Error(previewResult.error.message)
          const page = parsePreviewPage(previewResult.value)
          if (
            page.preview.id !== previewLaunch.previewId
            || page.page.id !== previewLaunch.pageId
            || page.preview.persona !== previewLaunch.persona
          ) throw new Error('OBIS application preview response did not match the launch-bound preview.')
          renderPreviewOverlay(page)
          window.dispatchEvent(new CustomEvent('obis:application-preview-ready', {
            detail: {
              preview: previewLaunch,
              environmentId: exchange.launch.environmentId,
              autonomy: exchange.launch.autonomy,
              page,
            },
          }))
        }).catch((error: unknown) => {
          console.error('[obis-launch] application preview failed:', error)
          window.dispatchEvent(new CustomEvent('obis:application-preview-failed', {
            detail: { message: error instanceof Error ? error.message : String(error) },
          }))
        })
        return
      }
      void connection.rpc.call('/obis-launch', 'catalog', undefined).then((catalogResult) => {
        if (!catalogResult.ok) throw new Error(catalogResult.error.message)
        const catalog = parseCatalog(catalogResult.value)
        renderCatalogOverlay(catalog, (item) => { openPublishedPage(connection, item, catalog) })
        window.dispatchEvent(new CustomEvent('obis:application-catalog-ready', { detail: catalog }))
      }).catch((error: unknown) => {
        console.error('[obis-launch] published catalog failed:', error)
        window.dispatchEvent(new CustomEvent('obis:application-catalog-failed', {
          detail: { message: error instanceof Error ? error.message : String(error) },
        }))
      })
    }
  }).catch((error: unknown) => {
    console.error('[obis-launch] secure workspace handoff failed:', error)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('obis:launch-failed', {
        detail: { message: error instanceof Error ? error.message : String(error) },
      }))
    }
  })
}
