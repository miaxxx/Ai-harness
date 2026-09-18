import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, safeStorage } from 'electron'
import type {
  DesktopApplicationActionBinding,
  DesktopApplicationActionRequest,
  DesktopApplicationAiRequest,
  DesktopApplicationAiResult,
  DesktopApplicationActionResult,
  DesktopApplicationNavigationRecord,
  DesktopApplicationPageEnvelope,
  DesktopApplicationPageRequest,
  DesktopApplicationPageSchema,
  DesktopApplicationPermissionDecision,
  DesktopApplicationQueryItem,
  DesktopApplicationQueryRequest,
  DesktopApplicationQueryResult,
  DesktopApplicationRuntimeBindings,
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

async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const identity = await authenticatedIdentity()
  try {
    return await requestJson<T>(identity.stored, path, identity.accessToken, init)
  } catch (error) {
    if (!(error instanceof ApplicationHttpError) || error.status !== 401) throw error
    const refreshed = await refreshIdentity(identity.stored)
    return requestJson<T>(refreshed.stored, path, refreshed.accessToken, init)
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

function parseQueryItem(value: unknown): DesktopApplicationQueryItem {
  const row = record(value)
  const values = record(row?.values)
  if (!row || !values) throw new Error('OBIS returned an invalid application query item')
  if (typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1) throw new Error('Application query item version is invalid')
  return {
    id: requiredString(row.id, 'query.item.id'),
    object: requiredString(row.object, 'query.item.object'),
    values,
    version: row.version,
    createdAt: requiredString(row.createdAt, 'query.item.createdAt'),
    updatedAt: requiredString(row.updatedAt, 'query.item.updatedAt'),
  }
}

function parseQueryResult(value: unknown): DesktopApplicationQueryResult {
  const row = record(value)
  const decision = record(row?.decision)
  if (!row || !decision || !['executed', 'denied', 'invalid'].includes(String(row.status))) {
    throw new Error('OBIS returned an invalid application query result')
  }
  return {
    requestId: requiredString(row.requestId, 'query.requestId'),
    status: row.status as DesktopApplicationQueryResult['status'],
    query: requiredString(row.query, 'query.query'),
    ...(typeof row.object === 'string' && row.object.trim() ? { object: row.object.trim() } : {}),
    ...(typeof row.artifactId === 'string' && row.artifactId.trim() ? { artifactId: row.artifactId.trim() } : {}),
    decision: {
      allowed: decision.allowed === true,
      matchedPolicies: stringArray(decision.matchedPolicies),
      reason: requiredString(decision.reason, 'query.decision.reason'),
    },
    items: Array.isArray(row.items) ? row.items.map(parseQueryItem) : [],
    truncated: row.truncated === true,
    errors: stringArray(row.errors),
  }
}

function parseAiResult(value: unknown): DesktopApplicationAiResult {
  const row = record(value)
  if (!row || (row.mode !== 'summary' && row.mode !== 'compose')) {
    throw new Error('OBIS returned an invalid application AI result')
  }
  return {
    mode: row.mode,
    text: requiredString(row.text, 'ai.text'),
    traceId: requiredString(row.traceId, 'ai.traceId'),
    providerProfileId: requiredString(row.providerProfileId, 'ai.providerProfileId'),
    modelId: requiredString(row.modelId, 'ai.modelId'),
  }
}

function parseActionResult(value: unknown, idempotencyKey: string): DesktopApplicationActionResult {
  const row = record(value)
  const decision = record(row?.decision)
  if (!row || !decision || !['executed', 'denied', 'approval-required', 'invalid', 'failed'].includes(String(row.status))) {
    throw new Error('OBIS returned an invalid application action result')
  }
  return {
    requestId: requiredString(row.requestId, 'action.requestId'),
    idempotencyKey,
    status: row.status as DesktopApplicationActionResult['status'],
    decision: {
      allowed: decision.allowed === true,
      matchedPolicies: stringArray(decision.matchedPolicies),
      reason: requiredString(decision.reason, 'action.decision.reason'),
      ...(typeof decision.requiresApproval === 'string' && decision.requiresApproval.trim()
        ? { requiresApproval: decision.requiresApproval.trim() }
        : {}),
    },
    ...(row.output !== undefined ? { output: row.output } : {}),
  }
}

const APPLICATION_FIELD_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'datetime', 'json', 'ref'])

function parseActionBinding(value: unknown): DesktopApplicationActionBinding {
  const row = record(value)
  const input = record(row?.input)
  if (!row || !input) throw new Error('OBIS returned an invalid application action binding')
  const fields: DesktopApplicationActionBinding['input'] = {}
  for (const [name, rawField] of Object.entries(input)) {
    const field = record(rawField)
    const type = typeof field?.type === 'string' ? field.type : ''
    if (!field || !APPLICATION_FIELD_TYPES.has(type)) {
      throw new Error(`Application action field ${name} has an unsupported type`)
    }
    fields[name] = {
      type: type as DesktopApplicationActionBinding['input'][string]['type'],
      required: field.required === true,
      ...(typeof field.ref === 'string' && field.ref.trim() ? { ref: field.ref.trim() } : {}),
    }
  }
  const risk = typeof row.risk === 'string' && ['low', 'medium', 'high', 'critical'].includes(row.risk)
    ? row.risk as DesktopApplicationActionBinding['risk']
    : undefined
  return {
    name: requiredString(row.name, 'runtime.action.name'),
    target: requiredString(row.target, 'runtime.action.target'),
    ...(risk ? { risk } : {}),
    ...(typeof row.approval === 'string' && row.approval.trim() ? { approval: row.approval.trim() } : {}),
    input: fields,
  }
}

function parseRuntimeBindings(value: unknown): DesktopApplicationRuntimeBindings | undefined {
  if (value === undefined) return undefined
  const row = record(value)
  if (!row || !Array.isArray(row.actions)) throw new Error('OBIS returned invalid application runtime bindings')
  const query = record(row.query)
  const queryFilters = record(query?.filters)
  const parsedFilters: NonNullable<DesktopApplicationRuntimeBindings['query']>['filters'] = {}
  for (const [name, rawField] of Object.entries(queryFilters ?? {})) {
    const field = record(rawField)
    const type = typeof field?.type === 'string' ? field.type : ''
    if (!field || !APPLICATION_FIELD_TYPES.has(type)) {
      throw new Error(`Application query filter ${name} has an unsupported type`)
    }
    parsedFilters[name] = {
      type: type as NonNullable<DesktopApplicationRuntimeBindings['query']>['filters'][string]['type'],
      ...(typeof field.ref === 'string' && field.ref.trim() ? { ref: field.ref.trim() } : {}),
    }
  }
  const parsedQuery = query
    ? {
      name: requiredString(query.name, 'runtime.query.name'),
      object: requiredString(query.object, 'runtime.query.object'),
      fields: stringArray(query.fields),
      filterable: stringArray(query.filterable),
      filters: parsedFilters,
      ...(typeof query.defaultLimit === 'number' && Number.isInteger(query.defaultLimit) && query.defaultLimit > 0
        ? { defaultLimit: query.defaultLimit }
        : {}),
      ...(typeof query.maxLimit === 'number' && Number.isInteger(query.maxLimit) && query.maxLimit > 0
        ? { maxLimit: query.maxLimit }
        : {}),
    }
    : undefined
  return {
    ...(parsedQuery ? { query: parsedQuery } : {}),
    actions: row.actions.map(parseActionBinding),
  }
}

function parsePageEnvelope(value: unknown): DesktopApplicationPageEnvelope {
  const row = record(value)
  const module = record(row?.module)
  const designSystem = record(row?.designSystem)
  if (!row || !module || !designSystem) throw new Error('OBIS returned an invalid application page envelope')
  const page = parsePageSchema(row.page)
  const runtime = parseRuntimeBindings(row.runtime)
  if (runtime?.query && runtime.query.name !== page.source?.query) {
    throw new Error('Application runtime query binding does not match the governed page source')
  }
  for (const action of runtime?.actions ?? []) {
    if (!(page.actions ?? []).includes(action.name)) {
      throw new Error(`Application runtime action ${action.name} is not declared by the governed page`)
    }
  }
  const envelope: DesktopApplicationPageEnvelope = {
    module: {
      id: requiredString(module.id, 'module.id'),
      version: requiredString(module.version, 'module.version'),
      name: requiredString(module.name, 'module.name'),
    },
    page,
    designSystem: {
      id: requiredString(designSystem.id, 'designSystem.id'),
      version: requiredString(designSystem.version, 'designSystem.version'),
    },
    permissions: parsePermissions(row.permissions),
    ...(runtime ? { runtime } : {}),
  }
  if (!envelope.permissions.visible) {
    throw new Error('OBIS returned an application page without visible entitlement')
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

async function applicationQuery(value: unknown): Promise<DesktopApplicationQueryResult> {
  const scope = requireValidatedScope(value)
  const row = record(value)
  if (!row) throw new Error('Application query request must be an object')
  const moduleId = requiredString(row.moduleId, 'moduleId')
  const pageId = requiredString(row.pageId, 'pageId')
  const where = row.where === undefined ? undefined : record(row.where)
  const context = row.context === undefined ? undefined : record(row.context)
  if (row.where !== undefined && !where) throw new Error('where must be an object')
  if (row.context !== undefined && !context) throw new Error('context must be an object')
  if (row.id !== undefined && typeof row.id !== 'string') throw new Error('id must be a string')
  if (row.limit !== undefined && (typeof row.limit !== 'number' || !Number.isInteger(row.limit) || row.limit < 1 || row.limit > 1000)) {
    throw new Error('limit must be an integer between 1 and 1000')
  }
  const input: DesktopApplicationQueryRequest = {
    ...scope,
    moduleId,
    pageId,
    ...(typeof row.id === 'string' && row.id.trim() ? { id: row.id.trim() } : {}),
    ...(where ? { where } : {}),
    ...(typeof row.limit === 'number' ? { limit: row.limit } : {}),
    ...(context ? { context } : {}),
  }
  const payload = await authenticatedRequest<unknown>(
    `/v1/workspace/modules/${encodeURIComponent(moduleId)}/pages/${encodeURIComponent(pageId)}/query`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: input.projectId,
        environmentId: input.environmentId,
        ...(input.id ? { id: input.id } : {}),
        ...(input.where ? { where: input.where } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
        ...(input.context ? { context: input.context } : {}),
      }),
    },
  )
  const result = parseQueryResult(payload)
  if (result.status !== 'executed' || !result.decision.allowed) {
    throw new Error(result.decision.reason || 'The governed application query was denied')
  }
  return result
}

async function applicationAction(value: unknown): Promise<DesktopApplicationActionResult> {
  const scope = requireValidatedScope(value)
  const row = record(value)
  if (!row) throw new Error('Application action request must be an object')
  const input = record(row.input)
  if (!input) throw new Error('Application action input must be an object')
  const moduleId = requiredString(row.moduleId, 'moduleId')
  const pageId = requiredString(row.pageId, 'pageId')
  const action = requiredString(row.action, 'action')
  if (row.targetId !== undefined && typeof row.targetId !== 'string') throw new Error('targetId must be a string')
  if (row.expectedVersion !== undefined && (typeof row.expectedVersion !== 'number' || !Number.isInteger(row.expectedVersion) || row.expectedVersion < 1)) {
    throw new Error('expectedVersion must be a positive integer')
  }
  const idempotencyKey = typeof row.idempotencyKey === 'string' && row.idempotencyKey.trim()
    ? row.idempotencyKey.trim()
    : `desktop_${randomUUID()}`
  const request: DesktopApplicationActionRequest = {
    ...scope,
    moduleId,
    pageId,
    action,
    input,
    ...(typeof row.targetId === 'string' && row.targetId.trim() ? { targetId: row.targetId.trim() } : {}),
    ...(typeof row.expectedVersion === 'number' ? { expectedVersion: row.expectedVersion } : {}),
    idempotencyKey,
  }
  const payload = await authenticatedRequest<unknown>(
    `/v1/workspace/modules/${encodeURIComponent(moduleId)}/pages/${encodeURIComponent(pageId)}/actions/${encodeURIComponent(action)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: request.projectId,
        environmentId: request.environmentId,
        idempotencyKey,
        input: request.input,
        ...(request.targetId ? { targetId: request.targetId } : {}),
        ...(request.expectedVersion ? { expectedVersion: request.expectedVersion } : {}),
      }),
    },
  )
  return parseActionResult(payload, idempotencyKey)
}

async function applicationAi(value: unknown): Promise<DesktopApplicationAiResult> {
  const scope = requireValidatedScope(value)
  const row = record(value)
  if (!row) throw new Error('Application AI request must be an object')
  const moduleId = requiredString(row.moduleId, 'moduleId')
  const pageId = requiredString(row.pageId, 'pageId')
  if (row.mode !== 'summary' && row.mode !== 'compose') throw new Error('Application AI mode must be summary or compose')
  if (row.prompt !== undefined && typeof row.prompt !== 'string') throw new Error('Application AI prompt must be text')
  if (typeof row.prompt === 'string' && row.prompt.length > 12_000) throw new Error('Application AI prompt is too large')
  if (row.context !== undefined) {
    let encoded: string
    try {
      encoded = JSON.stringify(row.context)
    } catch {
      throw new Error('Application AI context must be JSON-serializable')
    }
    if (encoded.length > 60_000) throw new Error('Application AI context is too large')
  }
  const input: DesktopApplicationAiRequest = {
    ...scope,
    moduleId,
    pageId,
    mode: row.mode,
    ...(typeof row.prompt === 'string' && row.prompt.trim() ? { prompt: row.prompt.trim() } : {}),
    ...(row.context !== undefined ? { context: row.context } : {}),
  }
  const payload = await authenticatedRequest<unknown>(
    `/v1/workspace/modules/${encodeURIComponent(moduleId)}/pages/${encodeURIComponent(pageId)}/ai`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: input.projectId,
        environmentId: input.environmentId,
        mode: input.mode,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.context !== undefined ? { context: input.context } : {}),
      }),
    },
  )
  return parseAiResult(payload)
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
  ipcMain.handle('dsh:application-query', async (event, value: unknown) => {
    requireTrusted(event)
    return applicationQuery(value)
  })
  ipcMain.handle('dsh:application-action', async (event, value: unknown) => {
    requireTrusted(event)
    return applicationAction(value)
  })
  ipcMain.handle('dsh:application-ai', async (event, value: unknown) => {
    requireTrusted(event)
    return applicationAi(value)
  })
}

void app.whenReady().then(() => {
  installApplicationIpc()
})
