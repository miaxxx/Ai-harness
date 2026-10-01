import { describe, expect, it, vi } from 'vitest'
import {
  ObisHttpError,
  OHP_VERSION,
  loginWithPassword,
  signInAndRegisterInstallation,
} from '../src/desktop-obis-identity-protocol.ts'

const tokens = {
  sessionId: 'session_1',
  accessToken: 'obat_access',
  refreshToken: 'obrt_refresh',
  expiresAt: '2026-09-27T09:00:00.000Z',
  refreshExpiresAt: '2026-10-27T08:00:00.000Z',
}

const me = {
  user: { id: 'user_1', displayName: 'Owner', primaryEmail: 'owner@obis-dev.test' },
  membership: { tenantId: 'obis-dev', roles: ['owner'], status: 'active' },
  memberships: [{ tenantId: 'obis-dev', roles: ['owner'], status: 'active' }],
}

const installation = {
  installation: { id: 'harness_1', deviceId: 'desktop_1', status: 'online' },
  compatibility: { compatible: true },
}

const registration = {
  deviceName: 'darwin-arm64',
  os: 'darwin',
  architecture: 'arm64',
  harnessVersion: '0.1.1-rc.2',
  bridgeVersion: OHP_VERSION,
  protocolVersions: [OHP_VERSION],
  capabilities: ['agent', 'tools', 'skills', 'session'],
  channel: 'stable' as const,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Desktop OBIS password login', () => {
  it('rejects invalid email or password without calling /v1/me', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      error: { code: 'OHP_UNAUTHENTICATED', message: 'Invalid email or password.', correlationId: 'corr_1', retryable: false },
    }))
    await expect(loginWithPassword({
      baseURL: 'https://obis-api.obistech.com',
      tenantId: 'obis-dev',
      email: 'owner@obis-dev.test',
      password: 'wrong-password-value',
      deviceId: 'desktop_1',
    }, fetchImpl)).rejects.toMatchObject({
      name: 'ObisHttpError',
      status: 401,
      message: 'Invalid email or password.',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('logs in, reads /v1/me, then registers a Harness installation with OHP 1.0', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      const method = init?.method ?? 'GET'
      if (url.endsWith('/v1/auth/password/login') && method === 'POST') {
        expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
          tenantId: 'obis-dev',
          email: 'owner@obis-dev.test',
          password: 'correct-horse-battery',
          deviceId: 'desktop_1',
        })
        expect(new Headers(init?.headers).get('ohp-version')).toBeNull()
        return jsonResponse(200, tokens)
      }
      if (url.endsWith('/v1/me') && method === 'GET') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer obat_access')
        return jsonResponse(200, me)
      }
      if (url.endsWith('/v1/harness/installations') && method === 'POST') {
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer obat_access')
        expect(headers.get('ohp-version')).toBe('1.0')
        expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toMatchObject({
          deviceId: 'desktop_1',
          protocolVersions: ['1.0'],
          capabilities: ['agent', 'tools', 'skills', 'session'],
          channel: 'stable',
        })
        return jsonResponse(201, installation)
      }
      throw new Error(`unexpected ${method} ${url}`)
    })

    const result = await signInAndRegisterInstallation({
      baseURL: 'https://obis-api.obistech.com',
      tenantId: 'obis-dev',
      email: 'owner@obis-dev.test',
      password: 'correct-horse-battery',
      deviceId: 'desktop_1',
      registration,
    }, fetchImpl)

    expect(result.tokens.accessToken).toBe('obat_access')
    expect(result.me.user.primaryEmail).toBe('owner@obis-dev.test')
    expect(result.me.membership.roles).toEqual(['owner'])
    expect(result.installation.installation.id).toBe('harness_1')
    expect(result.installation.installation.status).toBe('online')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('fails closed when password login omits a token field', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { accessToken: 'obat_access' }))
    await expect(loginWithPassword({
      baseURL: 'https://obis-api.obistech.com',
      tenantId: 'obis-dev',
      email: 'owner@obis-dev.test',
      password: 'correct-horse-battery',
      deviceId: 'desktop_1',
    }, fetchImpl)).rejects.toThrow(/invalid token envelope/)
  })

  it('wraps non-OHP error bodies as ObisHttpError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { message: 'boom' }))
    await expect(loginWithPassword({
      baseURL: 'https://obis-api.obistech.com',
      tenantId: 'obis-dev',
      email: 'owner@obis-dev.test',
      password: 'x',
      deviceId: 'desktop_1',
    }, fetchImpl)).rejects.toBeInstanceOf(ObisHttpError)
  })
})
