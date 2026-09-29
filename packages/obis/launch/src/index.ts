/** Secure OBIS Workspace -> Harness handoff. The browser only carries a one-time ticket;
 * the Host exchanges it with OBIS and stores the delegated token behind the Credentials seam.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

export const name = 'obis-launch'

/** Workspace autonomy granted on the exchanged launch ticket. */
export type WorkspaceAutonomy = 'read-only' | 'recommend' | 'draft' | 'human-approved' | 'bounded-autonomous'
/** Preview overlay persona copied from the launch-bound preview metadata. */
export type ApplicationPreviewPersona = 'employee' | 'manager' | 'auditor' | 'developer'

/** Launch-bound application preview identifiers; Host `preview-page` uses these ids only. */
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

/** Non-secret launch metadata stored after a successful Host exchange. */
export interface WorkspaceLaunchState {
  id: string
  tenantId: string
  userId: string
  environmentId: string
  projectId?: string
  harnessOrigin: string
  goal?: string
  autonomy: WorkspaceAutonomy
  preview?: ApplicationPreviewLaunch
  createdAt: string
  expiresAt: string
  consumedAt?: string
}

interface WorkspaceLaunchExchange {
  access: {
    sessionId: string
    accessToken: string
    expiresAt: string
  }
  launch: WorkspaceLaunchState
}

/** Browser-safe exchange result: session id and expiry, never the delegated token. */
export interface SafeWorkspaceLaunchExchange {
  access: {
    sessionId: string
    expiresAt: string
  }
  launch: WorkspaceLaunchState
}

/** Launch-bound entitled navigation returned by Host RPC `catalog`. */
export interface WorkspaceLaunchCatalog {
  projectId: string
  environmentId: string
  items: WorkspaceApplicationNavigationItem[]
}

/** Host plugin config for the OBIS Kernel base URL and delegated-token credential reference. */
export interface Config {
  /** OBIS kernel/API base URL. When absent, the bridge stays inert. */
  baseUrl?: string
  /** Harness credential reference that receives the short-lived delegated token. */
  credentialRef?: string
  /** Optional stable installation/device identifier forwarded to OBIS. */
  deviceId?: string
}

export const Config = z.object({
  baseUrl: z.string(),
  credentialRef: z.string().default('OBIS_DELEGATED_ACCESS_TOKEN'),
  deviceId: z.string(),
})

function normalizedBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('OBIS baseUrl must not include credentials, query parameters or fragments.')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname))) {
    throw new TypeError('OBIS baseUrl must use HTTPS unless it is loopback.')
  }
  return url.toString().replace(/\/$/, '')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function kernelErrorMessage(payload: unknown, fallback: string): string {
  const envelope = record(payload)
  const error = record(envelope?.error)
  return typeof error?.message === 'string' ? error.message : fallback
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json().catch(() => undefined)
}

function parsePreview(value: unknown): ApplicationPreviewLaunch | undefined {
  if (value === undefined) return undefined
  const row = record(value)
  if (!row) throw new Error('OBIS workspace launch preview metadata is invalid.')
  const persona = row.persona
  if (
    typeof row.projectId !== 'string' || typeof row.previewId !== 'string' || typeof row.pageId !== 'string'
    || (persona !== 'employee' && persona !== 'manager' && persona !== 'auditor' && persona !== 'developer')
  ) {
    throw new Error('OBIS workspace launch preview metadata is invalid.')
  }
  return {
    projectId: row.projectId,
    previewId: row.previewId,
    pageId: row.pageId,
    persona,
  }
}

function parseAutonomy(value: unknown): WorkspaceAutonomy | undefined {
  return value === 'read-only' || value === 'recommend' || value === 'draft' || value === 'human-approved' || value === 'bounded-autonomous'
    ? value
    : undefined
}

function requireLaunchString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value) {
    throw new Error('OBIS workspace launch exchange returned an invalid payload.')
  }
  return value
}

function parseExchange(value: unknown): WorkspaceLaunchExchange {
  const envelope = record(value)
  const access = record(envelope?.access)
  const launch = record(envelope?.launch)
  if (!access || !launch) throw new Error('OBIS workspace launch exchange returned an invalid payload.')
  const autonomy = parseAutonomy(launch.autonomy)
  if (autonomy === undefined) throw new Error('OBIS workspace launch exchange returned an invalid payload.')
  const preview = parsePreview(launch.preview)
  const sessionId = access.sessionId
  const accessToken = access.accessToken
  const expiresAt = access.expiresAt
  if (typeof sessionId !== 'string' || typeof accessToken !== 'string' || typeof expiresAt !== 'string') {
    throw new Error('OBIS workspace launch exchange returned an invalid payload.')
  }
  const projectId = typeof launch.projectId === 'string' && launch.projectId.trim() ? launch.projectId.trim() : undefined
  return {
    access: { sessionId, accessToken, expiresAt },
    launch: {
      id: requireLaunchString(launch, 'id'),
      tenantId: requireLaunchString(launch, 'tenantId'),
      userId: requireLaunchString(launch, 'userId'),
      environmentId: requireLaunchString(launch, 'environmentId'),
      harnessOrigin: requireLaunchString(launch, 'harnessOrigin'),
      autonomy,
      createdAt: requireLaunchString(launch, 'createdAt'),
      expiresAt: requireLaunchString(launch, 'expiresAt'),
      ...(projectId ? { projectId } : {}),
      ...(typeof launch.goal === 'string' ? { goal: launch.goal } : {}),
      ...(preview ? { preview } : {}),
      ...(typeof launch.consumedAt === 'string' ? { consumedAt: launch.consumedAt } : {}),
    },
  }
}

function parseNavigationItem(value: unknown): WorkspaceApplicationNavigationItem {
  const row = record(value)
  if (
    !row
    || typeof row.id !== 'string' || !row.id.trim()
    || typeof row.label !== 'string' || !row.label.trim()
    || typeof row.page !== 'string' || !row.page.trim()
    || typeof row.moduleId !== 'string' || !row.moduleId.trim()
    || typeof row.moduleVersion !== 'string' || !row.moduleVersion.trim()
  ) {
    throw new Error('OBIS workspace navigation returned an invalid catalog item.')
  }
  return {
    id: row.id.trim(),
    label: row.label.trim(),
    page: row.page.trim(),
    moduleId: row.moduleId.trim(),
    moduleVersion: row.moduleVersion.trim(),
    ...(typeof row.group === 'string' && row.group.trim() ? { group: row.group.trim() } : {}),
  }
}

function parseCatalog(value: unknown): WorkspaceApplicationNavigationItem[] {
  const row = record(value)
  if (!row || !Array.isArray(row.items)) throw new Error('OBIS workspace navigation returned an invalid catalog.')
  return row.items.map(parseNavigationItem)
}

function catalogIncludesPage(items: readonly WorkspaceApplicationNavigationItem[], moduleId: string, pageId: string): boolean {
  return items.some(item => item.moduleId === moduleId && item.page === pageId)
}

function rpcError(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function badRequest(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function emptyRpcPayload(payload: unknown): boolean {
  if (payload === undefined || payload === null) return true
  const row = record(payload)
  return row !== undefined && Object.keys(row).length === 0
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Latest successful OBIS Workspace handoff for this single-user Harness host. */
    obisLaunch: ObisLaunchService
  }
}

/**
 * Host-side one-time launch exchange. This service intentionally exposes only non-secret
 * launch metadata; the delegated token is written into ctx.credentials and never returned to the browser.
 */
export class ObisLaunchService extends Service {
  static inject = ['credentials', 'connection']
  static Config = Config

  private readonly baseUrl: string | undefined
  private readonly reference: CredentialRef
  private readonly deviceId: string | undefined
  private currentLaunch: WorkspaceLaunchState | undefined
  private boundApplicationModuleId: string | undefined

  constructor(ctx: Context, config: Config) {
    const baseUrl = config.baseUrl?.trim() ? normalizedBaseUrl(config.baseUrl.trim()) : undefined
    super(ctx, 'obisLaunch')
    this.baseUrl = baseUrl
    this.reference = credentialRef(config.credentialRef?.trim() || 'OBIS_DELEGATED_ACCESS_TOKEN')
    this.deviceId = config.deviceId?.trim() || undefined

    if (this.baseUrl !== undefined) {
      ctx.connection.rpc.handle('/obis-launch', async (endpoint, payload, signal) => {
        try {
          if (endpoint === 'exchange') {
            const body = record(payload)
            const ticket = typeof body?.ticket === 'string' ? body.ticket.trim() : ''
            const harnessOrigin = typeof body?.harnessOrigin === 'string' ? body.harnessOrigin.trim() : ''
            if (!ticket || !harnessOrigin) return badRequest('ticket and harnessOrigin are required.')
            return { ok: true, value: await this.exchange(ticket, harnessOrigin, signal) }
          }
          if (endpoint === 'preview-page') {
            if (!emptyRpcPayload(payload)) {
              return badRequest('preview-page does not accept caller-selected preview identifiers.')
            }
            return { ok: true, value: await this.previewPage(signal) }
          }
          if (endpoint === 'catalog') {
            if (!emptyRpcPayload(payload)) {
              return badRequest('catalog does not accept caller-selected project or environment identifiers.')
            }
            return { ok: true, value: await this.catalog(signal) }
          }
          if (endpoint === 'module-page') {
            const body = record(payload)
            const moduleId = typeof body?.moduleId === 'string' ? body.moduleId.trim() : ''
            const pageId = typeof body?.pageId === 'string' ? body.pageId.trim() : ''
            if (!body || !moduleId || !pageId || Object.keys(body).length !== 2) {
              return badRequest('module-page requires launch-bound moduleId and pageId only.')
            }
            return { ok: true, value: await this.modulePage(moduleId, pageId, signal) }
          }
          return badRequest(`Unknown OBIS launch endpoint ${endpoint}.`)
        } catch (error) {
          return rpcError(error instanceof Error ? error.message : String(error))
        }
      }, { authority: 'trusted-host' })
    }
  }

  /**
   * Latest successfully exchanged, non-secret launch metadata.
   * @returns a clone of the current launch, or undefined before a successful exchange
   */
  snapshot(): WorkspaceLaunchState | undefined {
    return this.currentLaunch === undefined ? undefined : structuredClone(this.currentLaunch)
  }

  /**
   * Credential reference where the current delegated token is stored.
   * @returns the configured credentials key, defaulting to `OBIS_DELEGATED_ACCESS_TOKEN`
   */
  tokenReference(): CredentialRef {
    return this.reference
  }

  /**
   * Published application module id pinned after a successful Host `module-page` call.
   * This id is Host-only: RPC results and `snapshot()` do not include it.
   * @returns the current module id, or undefined before a successful `module-page`
   */
  applicationModuleId(): string | undefined {
    return this.boundApplicationModuleId
  }

  private async delegatedToken(): Promise<string> {
    const credential = await this.ctx.credentials.resolve(this.reference)
    if (!credential?.value) throw new Error('The delegated OBIS launch credential is unavailable.')
    return credential.value
  }

  private kernelBaseUrl(): string {
    if (!this.baseUrl) throw new Error('OBIS Kernel base URL is unavailable before the launch exchange.')
    return this.baseUrl
  }

  private async previewPage(signal: AbortSignal): Promise<unknown> {
    const baseUrl = this.kernelBaseUrl()
    const launch = this.currentLaunch
    if (!launch?.preview) throw new Error('The current OBIS launch is not an application preview.')
    if (launch.autonomy !== 'read-only') throw new Error('Application preview launches must remain read-only.')
    const token = await this.delegatedToken()
    const preview = launch.preview
    const response = await fetch(
      `${baseUrl}/v1/application/previews/${encodeURIComponent(preview.previewId)}/pages/${encodeURIComponent(preview.pageId)}`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          projectId: preview.projectId,
          environmentId: launch.environmentId,
          persona: preview.persona,
        }),
        signal,
        redirect: 'error',
      },
    )
    const payload = await readJson(response)
    if (!response.ok) {
      throw new Error(kernelErrorMessage(payload, `OBIS application preview failed with ${response.status}.`))
    }
    return payload
  }

  private async catalog(signal: AbortSignal): Promise<WorkspaceLaunchCatalog> {
    const baseUrl = this.kernelBaseUrl()
    const launch = this.currentLaunch
    if (!launch) throw new Error('No OBIS workspace launch has been exchanged.')
    if (launch.preview) throw new Error('Published module catalog is unavailable for application preview launches.')
    const projectId = launch.projectId?.trim()
    if (!projectId) throw new Error('The current OBIS launch is missing projectId required for published module catalog.')
    const token = await this.delegatedToken()
    const query = new URLSearchParams({ projectId, environmentId: launch.environmentId })
    const response = await fetch(`${baseUrl}/v1/workspace/navigation?${query.toString()}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      signal,
      redirect: 'error',
    })
    const payload = await readJson(response)
    if (!response.ok) {
      throw new Error(kernelErrorMessage(payload, `OBIS workspace navigation failed with ${response.status}.`))
    }
    return {
      projectId,
      environmentId: launch.environmentId,
      items: parseCatalog(payload),
    }
  }

  private async modulePage(moduleId: string, pageId: string, signal: AbortSignal): Promise<unknown> {
    const catalog = await this.catalog(signal)
    if (!catalogIncludesPage(catalog.items, moduleId, pageId)) {
      throw new Error('Requested module page is not in the launch-bound entitled catalog.')
    }
    const token = await this.delegatedToken()
    const query = new URLSearchParams({ projectId: catalog.projectId, environmentId: catalog.environmentId })
    const response = await fetch(
      `${this.kernelBaseUrl()}/v1/workspace/modules/${encodeURIComponent(moduleId)}/pages/${encodeURIComponent(pageId)}?${query.toString()}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        signal,
        redirect: 'error',
      },
    )
    const payload = await readJson(response)
    if (!response.ok) {
      throw new Error(kernelErrorMessage(payload, `OBIS application page failed with ${response.status}.`))
    }
    this.boundApplicationModuleId = moduleId
    return payload
  }

  private async exchange(ticket: string, harnessOrigin: string, signal: AbortSignal): Promise<SafeWorkspaceLaunchExchange> {
    const baseUrl = this.kernelBaseUrl()
    const response = await fetch(`${baseUrl}/v1/workspace-launches/exchange`, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ ticket, harnessOrigin, ...(this.deviceId ? { deviceId: this.deviceId } : {}) }),
      signal,
    })
    const payload = await readJson(response)
    if (!response.ok) {
      throw new Error(kernelErrorMessage(payload, `OBIS launch exchange failed with ${response.status}.`))
    }
    const exchanged = parseExchange(payload)
    if (new URL(exchanged.launch.harnessOrigin).origin !== new URL(harnessOrigin).origin) {
      throw new Error('OBIS launch exchange returned a different Harness origin than requested.')
    }
    await this.ctx.credentials.set(this.reference, exchanged.access.accessToken)
    this.boundApplicationModuleId = undefined
    this.currentLaunch = exchanged.launch
    return {
      access: { sessionId: exchanged.access.sessionId, expiresAt: exchanged.access.expiresAt },
      launch: structuredClone(exchanged.launch),
    }
  }
}

export default ObisLaunchService
