import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, safeStorage } from 'electron'
import type {
  DesktopApprovalDecisionInput,
  DesktopApprovalDecisionResult,
  DesktopApprovalInbox,
  DesktopDirectoryUser,
  DesktopEnterpriseOverview,
  DesktopEnvironmentOperationsState,
  DesktopEnvironmentRuntimeState,
  DesktopMaintenanceRequestInput,
  DesktopMaintenanceTask,
  DesktopMaintenanceTaskType,
  DesktopModelBudgetSummary,
  DesktopModelUsageRecord,
  DesktopOperationsSnapshot,
  DesktopOverviewSection,
  DesktopScimProviderSummary,
  DesktopSsoProviderSummary,
} from './desktop-obis-identity-shared.ts'
import { enterpriseRuntimeScope } from './desktop-enterprise-scope-main.ts'

const APP_ORIGIN = 'dsh-app://app'
const ENVIRONMENT_STATES = new Set<DesktopEnvironmentRuntimeState>(['active', 'draining', 'maintenance', 'disabled'])
const MAINTENANCE_TYPES = new Set<DesktopMaintenanceTaskType>(['reconcile', 'cleanup', 'compact', 'update'])

interface StoredEnterpriseIdentity {
  version: number
  baseURL: string
  tenantId: string
  encryptedAccessToken?: string
  encryptedRefreshToken?: string
  expiresAt?: string
  refreshExpiresAt?: string
  sessionId?: string
  [key: string]: unknown
}

interface TokenPair {
  sessionId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
  refreshExpiresAt: string
}

class EnterpriseOverviewHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'EnterpriseOverviewHttpError'
  }
}

function storePath(): string {
  return join(app.getPath('userData'), 'obis-enterprise.json')
}

function validateBaseURL(raw: string): string {
  const value = raw.trim().replace(/\/$/, '')
  const parsed = new URL(value)
  const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localhost)) {
    throw new Error('OBIS URL must use HTTPS; HTTP is allowed only for localhost development')
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function trustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true
}

function requireTrusted(event: Electron.IpcMainInvokeEvent): void {
  if (!trustedSender(event)) throw new Error('enterprise overview IPC rejected an untrusted sender')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function roleMapping(value: unknown): Record<string, string[]> {
  const row = record(value)
  if (!row) return {}
  const result: Record<string, string[]> = {}
  for (const [key, roles] of Object.entries(row)) result[key] = stringArray(roles)
  return result
}

function ssoSummary(value: unknown): DesktopSsoProviderSummary | undefined {
  const row = record(value)
  if (!row || typeof row.id !== 'string' || (row.protocol !== 'oidc' && row.protocol !== 'saml') || typeof row.displayName !== 'string') return undefined
  return {
    id: row.id,
    protocol: row.protocol,
    displayName: row.displayName,
    enabled: row.enabled === true,
    allowJitLinkByEmail: row.allowJitLinkByEmail === true,
    defaultRoles: stringArray(row.defaultRoles),
    domainRules: stringArray(row.domainRules),
  }
}

function scimSummary(value: unknown): DesktopScimProviderSummary | undefined {
  const row = record(value)
  if (!row || typeof row.id !== 'string' || typeof row.displayName !== 'string') return undefined
  // Deliberately omit secretRef and all credential material before crossing the IPC boundary.
  return {
    id: row.id,
    displayName: row.displayName,
    enabled: row.enabled === true,
    defaultRoles: stringArray(row.defaultRoles),
    groupRoleMappings: roleMapping(row.groupRoleMappings),
  }
}

function parseStored(value: unknown): StoredEnterpriseIdentity {
  const row = record(value)
  if (!row || typeof row.baseURL !== 'string' || typeof row.tenantId !== 'string' || typeof row.version !== 'number') {
    throw new Error('The saved OBIS enterprise identity is invalid')
  }
  return {
    ...row,
    version: row.version,
    baseURL: validateBaseURL(row.baseURL),
    tenantId: row.tenantId,
    ...(typeof row.encryptedAccessToken === 'string' ? { encryptedAccessToken: row.encryptedAccessToken } : {}),
    ...(typeof row.encryptedRefreshToken === 'string' ? { encryptedRefreshToken: row.encryptedRefreshToken } : {}),
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
    ...(typeof row.refreshExpiresAt === 'string' ? { refreshExpiresAt: row.refreshExpiresAt } : {}),
    ...(typeof row.sessionId === 'string' ? { sessionId: row.sessionId } : {}),
  }
}

async function readStored(): Promise<StoredEnterpriseIdentity> {
  let raw: string
  try {
    raw = await readFile(storePath(), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Configure and sign in to OBIS before opening enterprise controls')
    }
    throw error
  }
  return parseStored(JSON.parse(raw) as unknown)
}

async function writeStored(stored: StoredEnterpriseIdentity): Promise<void> {
  const path = storePath()
  const temporary = `${path}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

function decrypt(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable; OBIS credentials cannot be read')
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable; OBIS credentials cannot be saved')
  return safeStorage.encryptString(value).toString('base64')
}

function apiMessage(payload: unknown, status: number): string {
  const row = record(payload)
  const error = record(row?.error)
  if (typeof error?.message === 'string') return error.message
  if (typeof row?.message === 'string') return row.message
  return `OBIS request failed with ${status}`
}

function isTokenPair(value: unknown): value is TokenPair {
  const row = record(value)
  return !!row
    && typeof row.sessionId === 'string'
    && typeof row.accessToken === 'string'
    && typeof row.refreshToken === 'string'
    && typeof row.expiresAt === 'string'
    && typeof row.refreshExpiresAt === 'string'
}

async function requestJson<T>(stored: StoredEnterpriseIdentity, path: string, accessToken?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`${stored.baseURL}${path}`, { ...init, headers })
  const payload = await response.json().catch(() => undefined) as unknown
  if (!response.ok) throw new EnterpriseOverviewHttpError(response.status, apiMessage(payload, response.status))
  return payload as T
}

async function refreshedAccessToken(stored: StoredEnterpriseIdentity): Promise<{ stored: StoredEnterpriseIdentity; accessToken: string }> {
  const refreshToken = decrypt(stored.encryptedRefreshToken)
  if (!refreshToken) throw new Error('Sign in to OBIS before opening enterprise controls')
  const tokens = await requestJson<TokenPair>(stored, '/v1/auth/refresh', undefined, {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  })
  if (!isTokenPair(tokens)) throw new Error('OBIS refresh returned an invalid token envelope')
  const next: StoredEnterpriseIdentity = {
    ...stored,
    encryptedAccessToken: encrypt(tokens.accessToken),
    encryptedRefreshToken: encrypt(tokens.refreshToken),
    sessionId: tokens.sessionId,
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  }
  await writeStored(next)
  return { stored: next, accessToken: tokens.accessToken }
}

async function authenticatedIdentity(): Promise<{ stored: StoredEnterpriseIdentity; accessToken: string }> {
  const stored = await readStored()
  const current = decrypt(stored.encryptedAccessToken)
  const valid = current !== undefined && (!stored.expiresAt || Date.parse(stored.expiresAt) > Date.now() + 30_000)
  if (valid) return { stored, accessToken: current }
  return refreshedAccessToken(stored)
}

async function authenticatedRequest<T>(path: string, init: RequestInit): Promise<T> {
  const identity = await authenticatedIdentity()
  try {
    return await requestJson<T>(identity.stored, path, identity.accessToken, init)
  } catch (error) {
    if (!(error instanceof EnterpriseOverviewHttpError) || error.status !== 401) throw error
    const refreshed = await refreshedAccessToken(identity.stored)
    return requestJson<T>(refreshed.stored, path, refreshed.accessToken, init)
  }
}

async function section<T>(operation: () => Promise<T>): Promise<DesktopOverviewSection<T>> {
  try {
    return { available: true, value: await operation() }
  } catch (error) {
    if (error instanceof EnterpriseOverviewHttpError) {
      return { available: false, status: error.status, error: error.message }
    }
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function requireValidatedScope(environmentId: string, projectId?: string): void {
  const scope = enterpriseRuntimeScope()
  if (!scope) throw new Error('A validated enterprise runtime scope is required')
  if (scope.environmentId !== environmentId) throw new Error('Requested environment is outside the active validated runtime scope')
  if (projectId !== undefined && scope.projectId !== projectId) throw new Error('Requested project is outside the active validated runtime scope')
}

function scopeQuery(environmentId: string, projectId?: string): string {
  const params = new URLSearchParams({ environmentId })
  if (projectId) params.set('projectId', projectId)
  return params.toString()
}

async function enterpriseOverview(scope: { environmentId: string; projectId?: string }): Promise<DesktopEnterpriseOverview> {
  const environmentId = scope.environmentId.trim()
  const projectId = scope.projectId?.trim() || undefined
  if (!environmentId) throw new Error('Environment is required for enterprise overview')
  requireValidatedScope(environmentId, projectId)
  const { stored, accessToken } = await authenticatedIdentity()
  const encodedEnvironment = encodeURIComponent(environmentId)
  const query = scopeQuery(environmentId, projectId)
  const [operations, approvals, users, ssoProviders, scimProviders, modelBudget, modelUsage] = await Promise.all([
    section(() => requestJson<DesktopOperationsSnapshot>(stored, `/v1/management/operations/environments/${encodedEnvironment}`, accessToken)),
    section(() => requestJson<DesktopApprovalInbox>(stored, `/v1/approvals/inbox?${new URLSearchParams({ environmentId }).toString()}`, accessToken)),
    section(async () => {
      const payload = await requestJson<{ items: DesktopDirectoryUser[] }>(stored, '/v1/management/users', accessToken)
      return payload.items
    }),
    section(async () => {
      const payload = await requestJson<{ items: unknown[] }>(stored, '/v1/management/sso/providers', accessToken)
      return payload.items.map(ssoSummary).filter((item): item is DesktopSsoProviderSummary => item !== undefined)
    }),
    section(async () => {
      const payload = await requestJson<{ items: unknown[] }>(stored, '/v1/management/scim/providers', accessToken)
      return payload.items.map(scimSummary).filter((item): item is DesktopScimProviderSummary => item !== undefined)
    }),
    section(() => requestJson<DesktopModelBudgetSummary>(stored, `/v1/management/model-budget-summary?${query}`, accessToken)),
    section(async () => {
      const payload = await requestJson<{ items: DesktopModelUsageRecord[] }>(stored, `/v1/management/model-usage?${query}&limit=25`, accessToken)
      return payload.items
    }),
  ])
  return {
    environmentId,
    ...(projectId ? { projectId } : {}),
    fetchedAt: new Date().toISOString(),
    operations,
    approvals,
    identity: { users, ssoProviders, scimProviders },
    modelBudget,
    modelUsage,
  }
}

async function decideApproval(input: DesktopApprovalDecisionInput): Promise<DesktopApprovalDecisionResult> {
  const approvalId = nonEmpty(input.approvalId, 'Approval id')
  const environmentId = nonEmpty(input.environmentId, 'Environment')
  requireValidatedScope(environmentId)
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error('Approval expectedVersion must be a positive integer')
  if (input.comment !== undefined && typeof input.comment !== 'string') throw new Error('Approval comment must be text')
  return authenticatedRequest<DesktopApprovalDecisionResult>(`/v1/approvals/${encodeURIComponent(approvalId)}/decisions`, {
    method: 'POST',
    body: JSON.stringify({
      environmentId,
      expectedVersion: input.expectedVersion,
      decision: input.decision,
      ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
    }),
  })
}

async function transitionEnvironment(input: { environmentId: string; to: DesktopEnvironmentRuntimeState; reason?: string }): Promise<DesktopEnvironmentOperationsState> {
  const environmentId = nonEmpty(input.environmentId, 'Environment')
  requireValidatedScope(environmentId)
  if (!ENVIRONMENT_STATES.has(input.to)) throw new Error('Invalid environment runtime state')
  return authenticatedRequest<DesktopEnvironmentOperationsState>(`/v1/management/operations/environments/${encodeURIComponent(environmentId)}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ to: input.to, ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}) }),
  })
}

async function requestMaintenance(input: DesktopMaintenanceRequestInput): Promise<DesktopMaintenanceTask> {
  const environmentId = nonEmpty(input.environmentId, 'Environment')
  requireValidatedScope(environmentId)
  if (!MAINTENANCE_TYPES.has(input.type)) throw new Error('Invalid maintenance task type')
  return authenticatedRequest<DesktopMaintenanceTask>(`/v1/management/operations/environments/${encodeURIComponent(environmentId)}/maintenance`, {
    method: 'POST',
    body: JSON.stringify({ type: input.type, ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}) }),
  })
}

function installEnterpriseOverviewIpc(): void {
  ipcMain.handle('dsh:enterprise-overview', async (event, value: unknown) => {
    requireTrusted(event)
    const row = record(value)
    if (!row || typeof row.environmentId !== 'string' || (row.projectId !== undefined && typeof row.projectId !== 'string')) {
      throw new Error('Enterprise overview scope must include an environmentId and optional projectId')
    }
    return enterpriseOverview({
      environmentId: row.environmentId,
      ...(typeof row.projectId === 'string' && row.projectId.trim() ? { projectId: row.projectId } : {}),
    })
  })

  ipcMain.handle('dsh:enterprise-approval-decision', async (event, value: unknown) => {
    requireTrusted(event)
    const row = record(value)
    if (!row) throw new Error('Approval decision payload is required')
    return decideApproval({
      approvalId: nonEmpty(row.approvalId, 'Approval id'),
      environmentId: nonEmpty(row.environmentId, 'Environment'),
      expectedVersion: Number(row.expectedVersion),
      decision: row.decision as 'approve' | 'reject',
      ...(typeof row.comment === 'string' ? { comment: row.comment } : {}),
    })
  })

  ipcMain.handle('dsh:enterprise-environment-transition', async (event, value: unknown) => {
    requireTrusted(event)
    const row = record(value)
    if (!row) throw new Error('Environment transition payload is required')
    return transitionEnvironment({
      environmentId: nonEmpty(row.environmentId, 'Environment'),
      to: row.to as DesktopEnvironmentRuntimeState,
      ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
    })
  })

  ipcMain.handle('dsh:enterprise-maintenance-request', async (event, value: unknown) => {
    requireTrusted(event)
    const row = record(value)
    if (!row) throw new Error('Maintenance request payload is required')
    return requestMaintenance({
      environmentId: nonEmpty(row.environmentId, 'Environment'),
      type: row.type as DesktopMaintenanceTaskType,
      ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
    })
  })
}

void app.whenReady().then(() => {
  installEnterpriseOverviewIpc()
})
