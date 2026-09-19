/** Secure OBIS Workspace -> Harness handoff. The browser only carries a one-time ticket;
 * the Host exchanges it with OBIS and stores the delegated token behind the Credentials seam.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

export const name = 'obis-launch'

export type WorkspaceAutonomy = 'read-only' | 'recommend' | 'draft' | 'human-approved' | 'bounded-autonomous'
export type ApplicationPreviewPersona = 'employee' | 'manager' | 'auditor' | 'developer'

export interface ApplicationPreviewLaunch {
  projectId: string
  previewId: string
  pageId: string
  persona: ApplicationPreviewPersona
}

export interface WorkspaceLaunchState {
  id: string
  tenantId: string
  userId: string
  environmentId: string
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

export interface SafeWorkspaceLaunchExchange {
  access: {
    sessionId: string
    expiresAt: string
  }
  launch: WorkspaceLaunchState
}

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
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) {
    throw new TypeError('OBIS baseUrl must use HTTPS unless it is loopback.')
  }
  return url.toString().replace(/\/$/, '')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
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

function parseExchange(value: unknown): WorkspaceLaunchExchange {
  const envelope = record(value)
  const access = record(envelope?.access)
  const launch = record(envelope?.launch)
  const autonomy = parseAutonomy(launch?.autonomy)
  const preview = parsePreview(launch?.preview)
  if (
    typeof access?.sessionId !== 'string' || typeof access.accessToken !== 'string' || typeof access.expiresAt !== 'string'
    || typeof launch?.id !== 'string' || typeof launch.tenantId !== 'string' || typeof launch.userId !== 'string'
    || typeof launch.environmentId !== 'string' || typeof launch.harnessOrigin !== 'string' || autonomy === undefined
    || typeof launch.createdAt !== 'string' || typeof launch.expiresAt !== 'string'
  ) {
    throw new Error('OBIS workspace launch exchange returned an invalid payload.')
  }
  return {
    access: { sessionId: access.sessionId, accessToken: access.accessToken, expiresAt: access.expiresAt },
    launch: {
      id: launch.id,
      tenantId: launch.tenantId,
      userId: launch.userId,
      environmentId: launch.environmentId,
      harnessOrigin: launch.harnessOrigin,
      autonomy,
      createdAt: launch.createdAt,
      expiresAt: launch.expiresAt,
      ...(typeof launch.goal === 'string' ? { goal: launch.goal } : {}),
      ...(preview ? { preview } : {}),
      ...(typeof launch.consumedAt === 'string' ? { consumedAt: launch.consumedAt } : {}),
    },
  }
}

function rpcError(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function badRequest(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
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

  constructor(ctx: Context, config: Config) {
    super(ctx, 'obisLaunch')
    this.baseUrl = config.baseUrl?.trim() ? normalizedBaseUrl(config.baseUrl.trim()) : undefined
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
            if (payload !== undefined && payload !== null && Object.keys(record(payload) ?? {}).length > 0) {
              return badRequest('preview-page does not accept caller-selected preview identifiers.')
            }
            return { ok: true, value: await this.previewPage(signal) }
          }
          return badRequest(`Unknown OBIS launch endpoint ${endpoint}.`)
        } catch (error) {
          return rpcError(error instanceof Error ? error.message : String(error))
        }
      }, { authority: 'trusted-host' })
    }
  }

  /** Latest successfully exchanged, non-secret launch metadata. */
  snapshot(): WorkspaceLaunchState | undefined {
    return this.currentLaunch === undefined ? undefined : structuredClone(this.currentLaunch)
  }

  /** Credential reference where the current delegated token is stored. */
  tokenReference(): CredentialRef {
    return this.reference
  }

  private async previewPage(signal: AbortSignal): Promise<unknown> {
    if (this.baseUrl === undefined) throw new Error('Harness is not configured with an OBIS baseUrl.')
    const launch = this.currentLaunch
    if (!launch?.preview) throw new Error('The current OBIS launch is not an application preview.')
    if (launch.autonomy !== 'read-only') throw new Error('Application preview launches must remain read-only.')
    const credential = await this.ctx.credentials.resolve(this.reference)
    if (!credential?.value) throw new Error('The delegated OBIS preview credential is unavailable.')
    const preview = launch.preview
    const response = await fetch(
      `${this.baseUrl}/v1/application/previews/${encodeURIComponent(preview.previewId)}/pages/${encodeURIComponent(preview.pageId)}`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${credential.value}`,
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
    const payload = await response.json().catch(() => undefined) as unknown
    if (!response.ok) {
      const envelope = record(payload)
      const error = record(envelope?.error)
      const message = typeof error?.message === 'string'
        ? error.message
        : `OBIS application preview failed with ${response.status}.`
      throw new Error(message)
    }
    return payload
  }

  private async exchange(ticket: string, harnessOrigin: string, signal: AbortSignal): Promise<SafeWorkspaceLaunchExchange> {
    if (this.baseUrl === undefined) throw new Error('Harness is not configured with an OBIS baseUrl.')
    const response = await fetch(`${this.baseUrl}/v1/workspace-launches/exchange`, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ ticket, harnessOrigin, ...(this.deviceId ? { deviceId: this.deviceId } : {}) }),
      signal,
    })
    const payload = await response.json().catch(() => undefined) as unknown
    if (!response.ok) {
      const envelope = record(payload)
      const error = record(envelope?.error)
      const message = typeof error?.message === 'string' ? error.message : `OBIS launch exchange failed with ${response.status}.`
      throw new Error(message)
    }
    const exchanged = parseExchange(payload)
    if (new URL(exchanged.launch.harnessOrigin).origin !== new URL(harnessOrigin).origin) {
      throw new Error('OBIS launch exchange returned a different Harness origin than requested.')
    }
    await this.ctx.credentials.set(this.reference, exchanged.access.accessToken)
    this.currentLaunch = exchanged.launch
    return {
      access: { sessionId: exchanged.access.sessionId, expiresAt: exchanged.access.expiresAt },
      launch: structuredClone(exchanged.launch),
    }
  }
}

export default ObisLaunchService
