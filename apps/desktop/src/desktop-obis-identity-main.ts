import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, safeStorage } from 'electron'
import type {
  DesktopObisDeviceAuthorization,
  DesktopObisDeviceExchange,
  DesktopObisIdentityConfiguration,
  DesktopObisIdentityStatus,
  DesktopObisMembership,
} from './desktop-obis-identity-shared.ts'

const APP_ORIGIN = 'dsh-app://app'
const STORE_VERSION = 1

interface StoredObisIdentity {
  version: 1
  baseURL: string
  tenantId: string
  deviceId: string
  encryptedAccessToken?: string
  encryptedRefreshToken?: string
  sessionId?: string
  expiresAt?: string
  refreshExpiresAt?: string
  user?: { id: string; displayName: string; primaryEmail?: string }
  membership?: DesktopObisMembership
}

interface TokenPair {
  sessionId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
  refreshExpiresAt: string
}

interface MeResponse {
  user: { id: string; displayName: string; primaryEmail?: string }
  membership: DesktopObisMembership
}

function storePath(): string {
  return join(app.getPath('userData'), 'obis-enterprise.json')
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function requiredMode(): boolean {
  return process.env.OBIS_DESKTOP_REQUIRED?.trim() === '1'
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

function parseStored(value: unknown): StoredObisIdentity | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Partial<StoredObisIdentity>
  if (row.version !== STORE_VERSION || typeof row.baseURL !== 'string' || typeof row.tenantId !== 'string' || typeof row.deviceId !== 'string') return undefined
  return {
    version: STORE_VERSION,
    baseURL: validateBaseURL(row.baseURL),
    tenantId: row.tenantId.trim(),
    deviceId: row.deviceId,
    ...(typeof row.encryptedAccessToken === 'string' ? { encryptedAccessToken: row.encryptedAccessToken } : {}),
    ...(typeof row.encryptedRefreshToken === 'string' ? { encryptedRefreshToken: row.encryptedRefreshToken } : {}),
    ...(typeof row.sessionId === 'string' ? { sessionId: row.sessionId } : {}),
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
    ...(typeof row.refreshExpiresAt === 'string' ? { refreshExpiresAt: row.refreshExpiresAt } : {}),
    ...(row.user && typeof row.user.id === 'string' && typeof row.user.displayName === 'string' ? { user: row.user } : {}),
    ...(row.membership && typeof row.membership.tenantId === 'string' && Array.isArray(row.membership.roles) ? { membership: row.membership } : {}),
  }
}

async function readStored(): Promise<StoredObisIdentity | undefined> {
  try {
    return parseStored(JSON.parse(await readFile(storePath(), 'utf8')) as unknown)
  } catch (error: unknown) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

async function writeStored(stored: StoredObisIdentity): Promise<void> {
  const path = storePath()
  const temporary = `${path}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function ensureStored(): Promise<StoredObisIdentity | undefined> {
  const existing = await readStored()
  if (existing) return existing
  const baseURL = process.env.OBIS_BASE_URL?.trim()
  const tenantId = process.env.OBIS_TENANT_ID?.trim()
  if (!baseURL || !tenantId) return undefined
  const stored: StoredObisIdentity = {
    version: STORE_VERSION,
    baseURL: validateBaseURL(baseURL),
    tenantId,
    deviceId: `desktop_${randomUUID()}`,
  }
  await writeStored(stored)
  return stored
}

function publicStatus(stored: StoredObisIdentity | undefined): DesktopObisIdentityStatus {
  return {
    configured: stored !== undefined,
    required: requiredMode(),
    authenticated: stored?.encryptedRefreshToken !== undefined && stored.user !== undefined && stored.membership !== undefined,
    ...(stored ? { baseURL: stored.baseURL, tenantId: stored.tenantId, deviceId: stored.deviceId } : {}),
    ...(stored?.expiresAt ? { expiresAt: stored.expiresAt } : {}),
    ...(stored?.refreshExpiresAt ? { refreshExpiresAt: stored.refreshExpiresAt } : {}),
    ...(stored?.user ? { user: stored.user } : {}),
    ...(stored?.membership ? { membership: stored.membership } : {}),
  }
}

function encrypted(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable; OBIS credentials were not saved')
  return safeStorage.encryptString(value).toString('base64')
}

function decrypted(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable; OBIS credentials cannot be read')
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function withoutSession(stored: StoredObisIdentity): StoredObisIdentity {
  const { encryptedAccessToken: _access, encryptedRefreshToken: _refresh, sessionId: _session, expiresAt: _expires, refreshExpiresAt: _refreshExpires, user: _user, membership: _membership, ...profile } = stored
  return profile
}

function apiError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    if (error && typeof error === 'object' && !Array.isArray(error) && 'message' in error) {
      return String((error as { message?: unknown }).message ?? `OBIS request failed with ${status}`)
    }
    if (typeof error === 'string') return error
  }
  return `OBIS request failed with ${status}`
}

async function requestJson<T>(stored: StoredObisIdentity, path: string, input: {
  method?: 'GET' | 'POST'
  body?: unknown
  accessToken?: string
  allowAccepted?: boolean
} = {}): Promise<{ status: number; value: T }> {
  const headers = new Headers({ accept: 'application/json' })
  if (input.body !== undefined) headers.set('content-type', 'application/json')
  if (input.accessToken) headers.set('authorization', `Bearer ${input.accessToken}`)
  const response = await fetch(`${stored.baseURL}${path}`, {
    method: input.method ?? 'GET',
    headers,
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  })
  const payload = await response.json().catch(() => undefined) as T
  if (!response.ok && !(input.allowAccepted && response.status === 202)) throw new Error(apiError(payload, response.status))
  return { status: response.status, value: payload }
}

async function attachIdentity(stored: StoredObisIdentity, tokens: TokenPair): Promise<StoredObisIdentity> {
  const me = await requestJson<MeResponse>(stored, '/v1/me', { accessToken: tokens.accessToken })
  const next: StoredObisIdentity = {
    ...withoutSession(stored),
    encryptedAccessToken: encrypted(tokens.accessToken),
    encryptedRefreshToken: encrypted(tokens.refreshToken),
    sessionId: tokens.sessionId,
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
    user: me.value.user,
    membership: me.value.membership,
  }
  await writeStored(next)
  return next
}

async function refreshStored(stored: StoredObisIdentity): Promise<StoredObisIdentity> {
  const refreshToken = decrypted(stored.encryptedRefreshToken)
  if (!refreshToken) return stored
  try {
    const refreshed = await requestJson<TokenPair>(stored, '/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    })
    return attachIdentity(stored, refreshed.value)
  } catch (error) {
    await writeStored(withoutSession(stored))
    throw error
  }
}

async function currentIdentity(): Promise<DesktopObisIdentityStatus> {
  const stored = await ensureStored()
  if (!stored) return publicStatus(undefined)
  if (!stored.encryptedRefreshToken) return publicStatus(stored)
  const accessToken = decrypted(stored.encryptedAccessToken)
  if (accessToken && (!stored.expiresAt || Date.parse(stored.expiresAt) > Date.now() + 30_000)) {
    try {
      const me = await requestJson<MeResponse>(stored, '/v1/me', { accessToken })
      const next = { ...stored, user: me.value.user, membership: me.value.membership }
      await writeStored(next)
      return publicStatus(next)
    } catch {
      // Rotate with the refresh credential below.
    }
  }
  return publicStatus(await refreshStored(stored))
}

function trustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true
}

function requireTrusted(event: Electron.IpcMainInvokeEvent): void {
  if (!trustedSender(event)) throw new Error('enterprise identity IPC rejected an untrusted sender')
}

function installIdentityIpc(): void {
  ipcMain.handle('dsh:obis-identity-status', async (event) => {
    requireTrusted(event)
    return currentIdentity()
  })
  ipcMain.handle('dsh:obis-identity-configure', async (event, value: unknown) => {
    requireTrusted(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('OBIS identity configuration must be an object')
    const row = value as Partial<DesktopObisIdentityConfiguration>
    if (typeof row.baseURL !== 'string' || typeof row.tenantId !== 'string' || row.tenantId.trim() === '') {
      throw new Error('OBIS URL and tenant are required')
    }
    const existing = await readStored()
    const baseURL = validateBaseURL(row.baseURL)
    const tenantId = row.tenantId.trim()
    const sameAuthority = existing?.baseURL === baseURL && existing.tenantId === tenantId
    const next: StoredObisIdentity = sameAuthority && existing
      ? existing
      : { version: STORE_VERSION, baseURL, tenantId, deviceId: existing?.deviceId ?? `desktop_${randomUUID()}` }
    await writeStored(next)
    return publicStatus(next)
  })
  ipcMain.handle('dsh:obis-identity-device-start', async (event) => {
    requireTrusted(event)
    const stored = await ensureStored()
    if (!stored) throw new Error('Configure the OBIS URL and tenant before signing in')
    return (await requestJson<DesktopObisDeviceAuthorization>(stored, '/v1/auth/github/device/start', { method: 'POST' })).value
  })
  ipcMain.handle('dsh:obis-identity-device-exchange', async (event, deviceCode: unknown): Promise<DesktopObisDeviceExchange> => {
    requireTrusted(event)
    if (typeof deviceCode !== 'string' || deviceCode.trim() === '') throw new Error('GitHub device code is required')
    const stored = await ensureStored()
    if (!stored) throw new Error('Configure the OBIS URL and tenant before signing in')
    const response = await requestJson<TokenPair | { status: 'authorization_pending' | 'slow_down'; retryAfterSeconds?: number }>(
      stored,
      '/v1/auth/github/device/exchange',
      { method: 'POST', body: { tenantId: stored.tenantId, deviceCode: deviceCode.trim(), deviceId: stored.deviceId }, allowAccepted: true },
    )
    if (response.status === 202) return response.value as DesktopObisDeviceExchange
    const identity = publicStatus(await attachIdentity(stored, response.value as TokenPair))
    return { status: 'authenticated', identity }
  })
  ipcMain.handle('dsh:obis-identity-refresh', async (event) => {
    requireTrusted(event)
    return currentIdentity()
  })
  ipcMain.handle('dsh:obis-identity-logout', async (event) => {
    requireTrusted(event)
    const stored = await ensureStored()
    if (!stored) return publicStatus(undefined)
    let accessToken = decrypted(stored.encryptedAccessToken)
    if ((!accessToken || (stored.expiresAt && Date.parse(stored.expiresAt) <= Date.now())) && stored.encryptedRefreshToken) {
      try {
        const refreshed = await refreshStored(stored)
        accessToken = decrypted(refreshed.encryptedAccessToken)
      } catch {
        accessToken = undefined
      }
    }
    if (accessToken) {
      try { await requestJson(stored, '/v1/auth/logout', { method: 'POST', accessToken }) }
      catch { /* Local credential destruction still wins if the server is unreachable. */ }
    }
    const cleared = withoutSession(stored)
    await writeStored(cleared)
    return publicStatus(cleared)
  })
}

void app.whenReady().then(() => { installIdentityIpc() })
