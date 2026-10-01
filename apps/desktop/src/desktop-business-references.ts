/** Business composer references reuse the input pipeline and authorized navigation. */
import type { DesktopApplicationNavigationRecord } from './desktop-application-shared.ts'
import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { parseObisBusinessReference, serializeObisBusinessReference } from '@deepseek-ai/dsh-obis-bridge'

type Catalog = { scope: DesktopEnterpriseScopeRequest; pages: DesktopApplicationNavigationRecord[] }
let catalog: Catalog | undefined
let pending: Promise<Catalog | undefined> | undefined

/**
 * Share the validated sidebar directory with composer references for this renderer identity.
 * @param scope Server-validated project and environment.
 * @param pages Authorized published navigation; never an execution grant.
 */
export function seedBusinessReferenceCatalog(scope: DesktopEnterpriseScopeRequest, pages: DesktopApplicationNavigationRecord[]): void {
  catalog = { scope, pages }
}

async function refreshCatalog(): Promise<Catalog | undefined> {
  if (pending) return pending
  const previous = catalog
  const operation = (async () => {
    if (previous) {
      const pages = await window.dshApplications.navigation(previous.scope)
      if (catalog?.scope === previous.scope) seedBusinessReferenceCatalog(previous.scope, pages)
      return catalog
    }
    const identity = await window.dshEnterprise.status()
    if (!identity.authenticated) return undefined
    const [context, workspace] = await Promise.all([window.dshEnterprise.context(), window.dshEnterprise.workspace()])
    const tenant = context.tenants.find(item => item.id === context.currentTenantId)
    const projectId = workspace.preferences.defaultProjectId ?? tenant?.projects[0]?.id
    const environmentId = workspace.preferences.defaultEnvironmentId ?? tenant?.environments.find(item => item.status === 'active')?.id
    if (!projectId || !environmentId) return undefined
    const scope = await window.dshEnterprise.validateRuntimeScope({ projectId, environmentId })
    const pages = await window.dshApplications.navigation(scope)
    seedBusinessReferenceCatalog(scope, pages)
    return catalog
  })()
  pending = operation
  try { return await operation } finally { if (pending === operation) pending = undefined }
}

/** Warm display metadata without delaying composer interaction. */
export function warmBusinessReferenceCatalog(): void {
  void refreshCatalog().catch(() => { /* Cached display metadata does not authorize page or tool execution. */ })
}

/**
 * Supply authorized business sections to the existing command source.
 * @returns Candidate and codec behavior; credentials and execution remain Host-owned.
 */
export function desktopBusinessReferenceSource(): InputTriggerSource & { codec: NonNullable<InputTriggerSource['codec']> } {
  const source = {
    trigger: '/', name: 'obis', showGroupTitle: false,
    async candidates(_session, { query, signal }) {
      const current = catalog ?? await refreshCatalog()
      if (!current || signal.aborted) return []
      if (catalog) warmBusinessReferenceCatalog()
      const { scope, pages } = current
      const groups = ['业务应用', '公共空间', '资料库']
      const rows = groups.map((label, index) => ({ name: label, submenu: label, icon: '▦',
        description: '引用当前授权工作区；读取时由服务端再次检查权限。',
        value: JSON.stringify({ kind: ['applications', 'spaces', 'knowledge'][index],
          projectId: scope.projectId, environmentId: scope.environmentId, label }) }))
      for (const page of pages) {
        const value = JSON.stringify({ kind: 'module', projectId: scope.projectId, environmentId: scope.environmentId,
          label: page.label, moduleId: page.moduleId, moduleVersion: page.moduleVersion, pageId: page.page })
        rows.push({ name: page.label, submenu: page.label, icon: '▧', description: `已发布 ${page.moduleVersion}`, value })
        rows.push({ name: page.label, submenu: '业务应用', icon: '▧', description: `已发布 ${page.moduleVersion}`, value })
      }
      return rows.filter(row => query === '' || row.name.toLowerCase().includes(query.toLowerCase()))
        .map(row => ({ ...row, value: `obis:${row.value}` }))
    },
    onPick({ candidate }) {
      if (!candidate.value) return undefined
      const reference = parseObisBusinessReference(JSON.parse(candidate.value.slice(5)))
      return { insert: { source: 'command', ref: `obis:${JSON.stringify(reference)}`, label: reference.label,
        appearance: 'folder', clipboardText: `@"${reference.label}"` } }
    },
    codec: {
      clipboardText(ref) { return `@"${parseObisBusinessReference(JSON.parse(ref.slice(5))).label}"` },
      serialize(ref) { return Promise.resolve(serializeObisBusinessReference(parseObisBusinessReference(JSON.parse(ref.slice(5))))) },
    },
  } satisfies InputTriggerSource
  return source
}
