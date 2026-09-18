/** Browser companion for secure OBIS Workspace handoff.
 * The fragment carries only a one-time ticket. It is removed from history before
 * the Host RPC runs; delegated credentials never enter browser storage or JS state.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

export const inject = ['connection']

export type ApplicationPreviewPersona = 'employee' | 'manager' | 'auditor' | 'developer'

export interface ApplicationPreviewLaunch {
  projectId: string
  previewId: string
  pageId: string
  persona: ApplicationPreviewPersona
}

export interface SafeWorkspaceLaunchExchange {
  access: { sessionId: string; expiresAt: string }
  launch: {
    id: string
    tenantId: string
    userId: string
    environmentId: string
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
  props?: Record<string, unknown>
  children?: PreviewUiNode[]
}

interface PreviewPageEnvelope {
  preview: { id: string; moduleId: string; moduleVersion: string; sourceRevision: number; persona: ApplicationPreviewPersona }
  module: { id: string; version: string; name: string }
  page: { id: string; title: string; pattern?: string; layout: PreviewUiNode; actions?: string[] }
  designSystem: { id: string; version: string }
  access: { visible: boolean; executable: boolean; configurable: boolean; editable: boolean; administerable: boolean; reasons: string[] }
}

function previewRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function previewText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function previewNode(value: unknown): PreviewUiNode | undefined {
  const row = previewRecord(value)
  if (!row || typeof row.component !== 'string' || !row.component.trim()) return undefined
  const children = Array.isArray(row.children)
    ? row.children.map(previewNode).filter((item): item is PreviewUiNode => item !== undefined)
    : undefined
  const props = previewRecord(row.props)
  return {
    component: row.component.trim(),
    ...(typeof row.id === 'string' && row.id.trim() ? { id: row.id.trim() } : {}),
    ...(props ? { props } : {}),
    ...(children?.length ? { children } : {}),
  }
}

function parsePreviewPage(value: unknown): PreviewPageEnvelope {
  const row = previewRecord(value), preview = previewRecord(row?.preview), module = previewRecord(row?.module)
  const page = previewRecord(row?.page), designSystem = previewRecord(row?.designSystem), access = previewRecord(row?.access)
  const persona = preview?.persona
  const layout = previewNode(page?.layout)
  if (
    !row || !preview || !module || !page || !designSystem || !access || !layout
    || typeof preview.id !== 'string' || typeof preview.moduleId !== 'string' || typeof preview.moduleVersion !== 'string'
    || typeof preview.sourceRevision !== 'number'
    || (persona !== 'employee' && persona !== 'manager' && persona !== 'auditor' && persona !== 'developer')
    || typeof module.id !== 'string' || typeof module.version !== 'string' || typeof module.name !== 'string'
    || typeof page.id !== 'string' || typeof page.title !== 'string'
    || typeof designSystem.id !== 'string' || typeof designSystem.version !== 'string'
    || typeof access.visible !== 'boolean' || typeof access.executable !== 'boolean'
    || typeof access.configurable !== 'boolean' || typeof access.editable !== 'boolean' || typeof access.administerable !== 'boolean'
    || !Array.isArray(access.reasons) || !access.reasons.every(item => typeof item === 'string')
  ) throw new Error('OBIS application preview returned an invalid page envelope.')
  return {
    preview: {
      id: preview.id,
      moduleId: preview.moduleId,
      moduleVersion: preview.moduleVersion,
      sourceRevision: preview.sourceRevision,
      persona,
    },
    module: { id: module.id, version: module.version, name: module.name },
    page: {
      id: page.id,
      title: page.title,
      ...(typeof page.pattern === 'string' ? { pattern: page.pattern } : {}),
      layout,
      ...(Array.isArray(page.actions) && page.actions.every(item => typeof item === 'string') ? { actions: page.actions } : {}),
    },
    designSystem: { id: designSystem.id, version: designSystem.version },
    access: {
      visible: access.visible,
      executable: access.executable,
      configurable: access.configurable,
      editable: access.editable,
      administerable: access.administerable,
      reasons: access.reasons,
    },
  }
}

function previewElement(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function renderPreviewNode(node: PreviewUiNode): HTMLElement {
  const host = previewElement('section', `obis-preview-node obis-preview-${node.component.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`)
  host.dataset.component = node.component
  if (node.id) host.dataset.nodeId = node.id
  const label = previewText(node.props?.label) ?? previewText(node.props?.title) ?? previewText(node.props?.name)
  const value = previewText(node.props?.value) ?? previewText(node.props?.text)
  if (label) {
    const heading = previewElement('strong', 'obis-preview-node-label')
    heading.textContent = label
    host.append(heading)
  }
  if (value) {
    const body = previewElement('p', 'obis-preview-node-value')
    body.textContent = value
    host.append(body)
  }
  if (!label && !value && !node.children?.length) {
    const placeholder = previewElement('span', 'obis-preview-node-placeholder')
    placeholder.textContent = node.component
    host.append(placeholder)
  }
  for (const child of node.children ?? []) host.append(renderPreviewNode(child))
  return host
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
    .obis-preview-canvas{display:grid;gap:14px}.obis-preview-node{border:1px solid rgba(22,24,29,.12);border-radius:12px;background:white;padding:14px;display:grid;gap:10px}.obis-preview-stack,.obis-preview-section,.obis-preview-page{display:grid}.obis-preview-grid,.obis-preview-dashboard{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
    .obis-preview-node-label{font-size:13px}.obis-preview-node-value,.obis-preview-node-placeholder{margin:0;color:#68707d;font-size:12px}.obis-preview-hidden{opacity:.58}
  `
  document.head.append(style)
}

function renderPreviewOverlay(envelope: PreviewPageEnvelope): void {
  document.getElementById('obis-application-preview')?.remove()
  ensurePreviewStyle()
  const backdrop = previewElement('div', 'obis-preview-backdrop')
  backdrop.id = 'obis-application-preview'
  const shell = previewElement('article', 'obis-preview-shell')
  if (!envelope.access.visible) shell.classList.add('obis-preview-hidden')
  const head = previewElement('header', 'obis-preview-head')
  const copy = previewElement('div')
  const kicker = previewElement('div', 'obis-preview-kicker')
  kicker.textContent = `Immutable preview · ${envelope.preview.persona} · revision ${envelope.preview.sourceRevision}`
  const title = previewElement('h1', 'obis-preview-title')
  title.textContent = envelope.page.title
  const meta = previewElement('p', 'obis-preview-meta')
  meta.textContent = `${envelope.module.name} · ${envelope.module.version} · ${envelope.designSystem.id}@${envelope.designSystem.version}`
  copy.append(kicker, title, meta)
  const close = previewElement('button', 'obis-preview-close') as HTMLButtonElement
  close.type = 'button'
  close.setAttribute('aria-label', 'Close application preview')
  close.textContent = '×'
  close.onclick = () => { backdrop.remove() }
  head.append(copy, close)

  const body = previewElement('div', 'obis-preview-body')
  const notice = previewElement('div', 'obis-preview-notice')
  notice.textContent = envelope.access.visible
    ? `Read-only preview. Production Query, Action, Approval and AI authority are disabled. Published executable entitlement would be ${String(envelope.access.executable)}.`
    : `This page is hidden for the simulated persona. ${envelope.access.reasons.join(' ')}`
  const canvas = previewElement('div', 'obis-preview-canvas')
  canvas.append(renderPreviewNode(envelope.page.layout))
  body.append(notice, canvas)
  shell.append(head, body)
  backdrop.append(shell)
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove() }
  document.body.append(backdrop)
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

/** Latest non-secret OBIS launch metadata saved by this browser tab. */
export function readObisLaunch(): SafeWorkspaceLaunchExchange | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return undefined
  try { return JSON.parse(raw) as SafeWorkspaceLaunchExchange } catch { return undefined }
}

export function readObisPreviewLaunch(): ApplicationPreviewLaunch | undefined {
  return readObisLaunch()?.launch.preview
}

export function apply(ctx: Context): void {
  const ticket = consumeTicketFromFragment()
  if (ticket === undefined || typeof location === 'undefined') return
  const harnessOrigin = location.origin

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('OBIS launch requires the client connection service.')
  void connection.rpc.call('/obis-launch', 'exchange', { ticket, harnessOrigin }).then((result) => {
    if (!result.ok) throw new Error(result.error?.message ?? 'OBIS launch exchange failed')
    const exchange = result.value as SafeWorkspaceLaunchExchange
    persistSafeLaunch(exchange)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('obis:launch-ready', { detail: exchange }))
      if (exchange.launch.preview) {
        void connection.rpc.call('/obis-launch', 'preview-page', undefined).then((previewResult) => {
          if (!previewResult.ok) throw new Error(previewResult.error?.message ?? 'OBIS application preview failed')
          const page = parsePreviewPage(previewResult.value)
          if (
            page.preview.id !== exchange.launch.preview?.previewId
            || page.page.id !== exchange.launch.preview.pageId
            || page.preview.persona !== exchange.launch.preview.persona
          ) throw new Error('OBIS application preview response did not match the launch-bound preview.')
          renderPreviewOverlay(page)
          window.dispatchEvent(new CustomEvent('obis:application-preview-ready', {
            detail: {
              preview: exchange.launch.preview,
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
      }
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
