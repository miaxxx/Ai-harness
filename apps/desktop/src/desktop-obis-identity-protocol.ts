import { isDesktopObisMembership, type DesktopObisMembership } from './desktop-obis-identity-shared.ts'

export const OHP_VERSION = '1.0'

export class ObisHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ObisHttpError'
  }
}

export interface ObisTokenPair {
  sessionId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
  refreshExpiresAt: string
}

export interface ObisMeResponse {
  user: { id: string; displayName: string; primaryEmail?: string }
  membership: DesktopObisMembership
  memberships?: DesktopObisMembership[]
}

export interface HarnessInstallationRegistration {
  deviceId: string
  deviceName: string
  os: string
  architecture: string
  harnessVersion: string
  bridgeVersion: string
  protocolVersions: readonly string[]
  capabilities: readonly string[]
  channel: 'canary' | 'stable' | 'enterprise-lts'
}

export interface HarnessInstallationEnvelope {
  installation: { id: string; deviceId: string; status: string }
  compatibility: unknown
}

export interface ObisJsonRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  body?: unknown
  accessToken?: string
  allowAccepted?: boolean
  ohp?: boolean
}

function apiError(payload: unknown, status: number): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !('error' in payload)) {
    return `OBIS request failed with ${status}`
  }
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && !Array.isArray(error) && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return `OBIS request failed with ${status}`
}

/** True when `value` is the Kernel password-login token envelope. */
export function isObisTokenPair(value: unknown): value is ObisTokenPair {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Partial<ObisTokenPair>
  return typeof row.sessionId === 'string'
    && typeof row.accessToken === 'string'
    && typeof row.refreshToken === 'string'
    && typeof row.expiresAt === 'string'
    && typeof row.refreshExpiresAt === 'string'
}

function isObisMeResponse(value: unknown): value is ObisMeResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Partial<ObisMeResponse>
  const user = row.user
  if (!user || typeof user !== 'object' || Array.isArray(user)) return false
  if (typeof user.id !== 'string' || typeof user.displayName !== 'string') return false
  if (user.primaryEmail !== undefined && typeof user.primaryEmail !== 'string') return false
  if (!isDesktopObisMembership(row.membership)) return false
  if (row.memberships !== undefined) {
    if (!Array.isArray(row.memberships) || !row.memberships.every(isDesktopObisMembership)) return false
  }
  return true
}

function isHarnessInstallationEnvelope(value: unknown): value is HarnessInstallationEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Partial<HarnessInstallationEnvelope>
  const installation = row.installation
  if (!installation || typeof installation !== 'object' || Array.isArray(installation)) return false
  return typeof installation.id === 'string'
    && typeof installation.deviceId === 'string'
    && typeof installation.status === 'string'
}

/**
 * JSON fetch against one OBIS Kernel origin.
 * @param baseURL Kernel origin without a trailing slash
 * @param path Absolute Kernel path beginning with `/`
 * @param input Method, JSON body, bearer token, and whether to send `ohp-version`
 * @param fetchImpl Fetch implementation; defaults to global `fetch`
 * @returns HTTP status and parsed JSON value
 */
export async function obisJsonRequest<T>(
  baseURL: string,
  path: string,
  input: ObisJsonRequest = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; value: T }> {
  const headers = new Headers({ accept: 'application/json' })
  if (input.body !== undefined) headers.set('content-type', 'application/json')
  if (input.accessToken) headers.set('authorization', `Bearer ${input.accessToken}`)
  if (input.ohp) headers.set('ohp-version', OHP_VERSION)
  const response = await fetchImpl(`${baseURL}${path}`, {
    method: input.method ?? 'GET',
    headers,
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok && !(input.allowAccepted && response.status === 202)) {
    throw new ObisHttpError(response.status, apiError(payload, response.status))
  }
  return { status: response.status, value: payload as T }
}

/**
 * Exchanges email and password for a Kernel token pair. Does not send OHP headers.
 * @param input Kernel origin, tenant, credentials, and device id
 * @param fetchImpl Fetch implementation; defaults to global `fetch`
 * @returns Token pair issued for that tenant membership
 */
export async function loginWithPassword(
  input: {
    baseURL: string
    tenantId: string
    email: string
    password: string
    deviceId: string
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ObisTokenPair> {
  const response = await obisJsonRequest<unknown>(input.baseURL, '/v1/auth/password/login', {
    method: 'POST',
    body: {
      tenantId: input.tenantId,
      email: input.email.trim(),
      password: input.password,
      deviceId: input.deviceId,
    },
  }, fetchImpl)
  if (!isObisTokenPair(response.value)) throw new Error('OBIS password login returned an invalid token envelope')
  return response.value
}

/**
 * Reads the authenticated user and tenant memberships.
 * @param input Kernel origin and access token
 * @param fetchImpl Fetch implementation; defaults to global `fetch`
 * @returns `/v1/me` user and membership payload
 */
export async function fetchMe(
  input: { baseURL: string; accessToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ObisMeResponse> {
  const response = await obisJsonRequest<unknown>(input.baseURL, '/v1/me', {
    accessToken: input.accessToken,
  }, fetchImpl)
  if (!isObisMeResponse(response.value)) throw new Error('OBIS /v1/me returned an invalid identity envelope')
  return response.value
}

/**
 * Registers this Desktop as a Harness installation under the authenticated user.
 * @param input Kernel origin, access token, and installation fields
 * @param fetchImpl Fetch implementation; defaults to global `fetch`
 * @returns Installation id and compatibility probe
 */
export async function registerHarnessInstallation(
  input: { baseURL: string; accessToken: string; registration: HarnessInstallationRegistration },
  fetchImpl: typeof fetch = fetch,
): Promise<HarnessInstallationEnvelope> {
  const response = await obisJsonRequest<unknown>(input.baseURL, '/v1/harness/installations', {
    method: 'POST',
    body: input.registration,
    accessToken: input.accessToken,
    ohp: true,
  }, fetchImpl)
  if (!isHarnessInstallationEnvelope(response.value)) {
    throw new Error('OBIS Harness registration returned an invalid installation')
  }
  return response.value
}

/**
 * Exchanges credentials for a token pair, reads `/v1/me`, then registers a Harness installation.
 * @param input Kernel origin, tenant, credentials, device id, and installation fields
 * @param fetchImpl Fetch implementation; defaults to global `fetch`
 * @returns Token pair, identity, and registered installation
 */
export async function signInAndRegisterInstallation(
  input: {
    baseURL: string
    tenantId: string
    email: string
    password: string
    deviceId: string
    registration: Omit<HarnessInstallationRegistration, 'deviceId'>
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ tokens: ObisTokenPair; me: ObisMeResponse; installation: HarnessInstallationEnvelope }> {
  const tokens = await loginWithPassword({
    baseURL: input.baseURL,
    tenantId: input.tenantId,
    email: input.email,
    password: input.password,
    deviceId: input.deviceId,
  }, fetchImpl)
  const me = await fetchMe({ baseURL: input.baseURL, accessToken: tokens.accessToken }, fetchImpl)
  const installation = await registerHarnessInstallation({
    baseURL: input.baseURL,
    accessToken: tokens.accessToken,
    registration: { ...input.registration, deviceId: input.deviceId },
  }, fetchImpl)
  return { tokens, me, installation }
}
