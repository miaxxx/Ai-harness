import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, safeStorage } from 'electron'
import type {
  DesktopApplicationNavigationRecord,
  DesktopApplicationPageEnvelope,
  DesktopApplicationPageRequest,
  DesktopApplicationPageSchema,
  DesktopApplicationPermissionDecision,
  DesktopApplicationUiNode,
} from './desktop-application-shared.ts'
import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import { enterpriseRuntimeScope } from './desktop-enterprise-scope-main.ts'

const APP_ORIGIN = 'dsh-app://app'

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

class ApplicationHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApplicationHttpError'
  }
}

function storePath(): string {
  return join(app.getPath('userData'), 'obis-enterprise.json')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function validateBaseURL(raw: string): string {
  const value = raw.trim().replace(/\/$/, '')
  const parsed = new URL(value)
  const localhost = parsed.hostname === 'localhost'
    || parsed.hostname === '127.0.0.1'
    || parsed.hostname === '::1'
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
  if (!trustedSender(event)) throw new Error('application IPC rejected an untrusted sender')
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
      throw new Error('Configure and sign in to OBIS before opening enterprise applications')
    }
    throw error
  }
  return parseStored(JSON.parse(raw) as unknown)
}

async function writeStored(stored: StoredEnterpriseIdentity): Promise<void> {
  const path = storePath()
  const temporary = `${path}.application.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

function decrypt(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable; OBIS credentials cannot be read')
  }
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable; OBIS credentials cannot be saved')
  }
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

async function requestJson<T>(
  stored: StoredEnterpriseIdentity,
  path: string,
  accessToken?: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`${stored.baseURL}${path}`, { ...init, headers })
  const payload = await response.json().catch(() => undefined) as unknown
  if (!response.ok) throw new ApplicationHttpError(response.status, apiMessage(payload, response.status))
  return payload as T
}

async function refreshIdentity(stored: StoredEnterpriseIdentity): Promise<{ stored: StoredEnterpriseIdentity; accessToken: string }> {
  const refreshToken = decrypt(stored.encryptedRefreshToken)
  if (!refreshToken) throw new Error('Sign in to OBIS before opening enterprise applications')
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
  return refreshIdentity(stored)
}

async function authenticatedRequest<T>(path: string): Promise<T> {
  const identity = await authenticatedIdentity()
  try {
    return await requestJson<T>(identity.stored, path, identity.accessToken)
  } catch (error) {
    if (!(error instanceof ApplicationHttpError) || error.status !== 401) throw error
    const refreshed = await refreshIdentity(identity.stored)
    return requestJson<T>(refreshed.stored, path, refreshed.accessToken)
  }
}

function parseScope(value: unknown): DesktopEnterpriseScopeRequest {
  const row = record(value)
  if (!row) throw new Error('Application scope must be an object')
  return {
    projectId: requiredString(row.projectId, 'projectId'),
    environmentId: requiredString(row.environmentId, 'environmentId'),
  }
}

function requireValidatedScope(value: unknown): DesktopEnterpriseScopeRequest {
  const request = parseScope(value)
  const active = enterpriseRuntimeScope()
  if (!active) throw new Error('A validated enterprise runtime scope is required before loading applications')
  if (active.projectId !== request.projectId || active.environmentId !== request.environmentId) {
    throw new Error('Application request is outside the active validated runtime scope')
  }
  return request
}

function parseNavigationRecord(value: unknown): DesktopApplicationNavigationRecord {
  const row = record(value)
  if (!row) throw new Error('OBIS returned an invalid application navigation item')
  const group = typeof row.group === 'string' && row.group.trim() ? row.group.trim() : undefined
  return {
    id: requiredString(row.id, 'navigation.id'),
    label: requiredString(row.label, 'navigation.label'),
    page: requiredString(row.page, 'navigation.page'),
    ...(group ? { group } : {}),
    moduleId: requiredString(row.moduleId, 'navigation.moduleId'),
    moduleVersion: requiredString(row.moduleVersion, 'navigation.moduleVersion'),
  }
}

function parseUiNode(value: unknown, depth = 0): DesktopApplicationUiNode {
  if (depth > 24) throw new Error('Application UI schema exceeds the supported nesting depth')
  const row = record(value)
  if (!row) throw new Error('OBIS returned an invalid application UI node')
  const props = record(row.props)
  return {
    component: requiredString(row.component, 'ui.component'),
    ...(typeof row.id === 'string' && row.id.trim() ? { id: row.id.trim() } : {}),
    ...(Array.isArray(row.tokenRefs) ? { tokenRefs: stringArray(row.tokenRefs) } : {}),
    ...(props ? { props } : {}),
    ...(Array.isArray(row.children) ? { children: row.children.map(child => parseUiNode(child, depth + 1)) } : {}),
  }
}

function parsePageSchema(value: unknown): DesktopApplicationPageSchema {
  const row = record(value)
  if (!row) throw new Error('OBIS returned an invalid application page schema')
  const source = record(row.source)
  const query = typeof source?.query === 'string' && source.query.trim() ? source.query.trim() : undefined
  return {
    id: requiredString(row.id, 'page.id'),
    title: requiredString(row.title, 'page.title'),
    ...(typeof row.pattern === 'string' && row.pattern.trim() ? { pattern: row.pattern.trim() } : {}),
    layout: parseUiNode(row.layout),
    ...(query ? { source: { query } } : {}),
    ...(Array.isArray(row.actions) ? { actions: stringArray(row.actions) } : {}),
  }
}

function parsePermissions(value: unknown): DesktopApplicationPermissionDecision {
  const row = record(value)
  if (!row) throw new Error('OBIS returned an invalid application permission decision')
  return {
    moduleId: requiredString(row.moduleId, 'permissions.moduleId'),
    moduleVersion: requiredString(row.moduleVersion, 'permissions.moduleVersion'),
    visible: row.visible === true,
    executable: row.executable === true,
    configurable: row.configurable === true,
    editable: row.editable === true,
    administerable: row.administerable === true,
    reasons: stringArray(row.reasons),
  }
}

function parsePageEnvelope(value: unknown): DesktopApplicationPageEnvelope {
  const row = record(value)
  const module = record(row?.module)
  const designSystem = record(row?.designSystem)
  if (!row || !module || !designSystem) throw new Error('OBIS returned an invalid application page envelope')
  const envelope: DesktopApplicationPageEnvelope = {
    module: {
      id: requiredString(module.id, 'module.id'),
      version: requiredString(module.version, 'module.version'),
      name: requiredString(module.name, 'module.name'),
    },
    page: parsePageSchema(row.page),
    designSystem: {
      id: requiredString(designSystem.id, 'designSystem.id'),
      version: requiredString(designSystem.version, 'designSystem.version'),
    },
    permissions: parsePermissions(row.permissions),
  }
  if (!envelope.permissions.visible || !envelope.permissions.executable) {
    throw new Error('OBIS returned an application page without executable entitlement')
  }
  if (
    envelope.permissions.moduleId !== envelope.module.id
    || envelope.permissions.moduleVersion !== envelope.module.version
  ) {
    throw new Error('Application permission decision does not match the resolved module version')
  }
  return envelope
}

async function applicationNavigation(value: unknown): Promise<DesktopApplicationNavigationRecord[]> {
  const scope = requireValidatedScope(value)
  const params = new URLSearchParams({ projectId: scope.projectId, environmentId: scope.environmentId })
  const payload = await authenticatedRequest<{ items?: unknown[] }>(`/v1/workspace/navigation?${params.toString()}`)
  if (!Array.isArray(payload.items)) throw new Error('OBIS returned an invalid application navigation envelope')
  return payload.items.map(parseNavigationRecord)
}

async function applicationPage(value: unknown): Promise<DesktopApplicationPageEnvelope> {
  const scope = requireValidatedScope(value)
  const row = record(value)
  if (!row) throw new Error('Application page request must be an object')
  const input: DesktopApplicationPageRequest = {
    ...scope,
    moduleId: requiredString(row.moduleId, 'moduleId'),
    pageId: requiredString(row.pageId, 'pageId'),
  }
  const params = new URLSearchParams({ projectId: input.projectId, environmentId: input.environmentId })
  const payload = await authenticatedRequest<unknown>(
    `/v1/workspace/modules/${encodeURIComponent(input.moduleId)}/pages/${encodeURIComponent(input.pageId)}?${params.toString()}`,
  )
  const envelope = parsePageEnvelope(payload)
  if (envelope.module.id !== input.moduleId || envelope.page.id !== input.pageId) {
    throw new Error('OBIS resolved a different module page than the requested application route')
  }
  return envelope
}

function installApplicationIpc(): void {
  ipcMain.handle('dsh:application-navigation', async (event, value: unknown) => {
    requireTrusted(event)
    return applicationNavigation(value)
  })
  ipcMain.handle('dsh:application-page', async (event, value: unknown) => {
    requireTrusted(event)
    return applicationPage(value)
  })
}

void app.whenReady().then(() => {
  installApplicationIpc()
})
