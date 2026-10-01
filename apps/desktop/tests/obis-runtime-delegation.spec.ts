import { describe, expect, it, vi } from 'vitest'
import { issueDesktopRuntimeDelegation } from '../src/desktop-obis-runtime-protocol.ts'

const scope = { tenantId: 'tenant', projectId: 'project', environmentId: 'test', userId: 'employee', installationId: 'installation' }
const input = { baseURL: 'https://api.example.test', accessToken: 'human-token', deviceId: 'native-device', harnessOrigin: 'https://app.example.test', scope }
const launch = { ...scope, autonomy: 'read-only' }
const expiry = new Date(Date.now() + 60_000).toISOString()
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

describe('native runtime ticket delegation', () => {
  it('exchanges the one-time ticket without forwarding human access to exchange', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ticket: 'one-time', launch }, 201))
      .mockResolvedValueOnce(json({ launch, access: { accessToken: 'delegated', expiresAt: expiry } }))
    expect(await issueDesktopRuntimeDelegation(input, transport)).toEqual({ accessToken: 'delegated', expiresAt: expiry })
    const first = transport.mock.calls[0]
    const second = transport.mock.calls[1]
    expect(first?.[0]).toBe('https://api.example.test/v1/workspace-launches')
    expect(new Headers(first?.[1]?.headers).get('authorization')).toBe('Bearer human-token')
    expect(JSON.parse(String(first?.[1]?.body))).toEqual({ projectId: 'project', environmentId: 'test', harnessOrigin: input.harnessOrigin, autonomy: 'read-only' })
    expect(second?.[0]).toBe('https://api.example.test/v1/workspace-launches/exchange')
    expect(new Headers(second?.[1]?.headers).has('authorization')).toBe(false)
    expect(JSON.parse(String(second?.[1]?.body))).toEqual({ ticket: 'one-time', harnessOrigin: input.harnessOrigin, deviceId: input.deviceId })
  })

  it.each(['tenantId', 'projectId', 'environmentId', 'userId', 'autonomy'])('rejects a mismatched issued %s before consuming the ticket', async (key) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ ticket: 'one-time', launch: { ...launch, [key]: 'other' } }))
    await expect(issueDesktopRuntimeDelegation(input, transport)).rejects.toThrow('作用域')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('refuses a mismatched exchanged scope and an expired delegated credential', async () => {
    for (const envelope of [
      { launch: { ...launch, userId: 'other' }, access: { accessToken: 'delegated', expiresAt: expiry } },
      { launch, access: { accessToken: 'delegated', expiresAt: new Date(0).toISOString() } },
    ]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ticket: 'one-time', launch })).mockResolvedValueOnce(json(envelope))
      await expect(issueDesktopRuntimeDelegation(input, transport)).rejects.toThrow()
    }
  })

  it('keeps a server refusal as a refusal without exchanging credentials', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ error: { message: 'Scope revoked' } }, 403))
    await expect(issueDesktopRuntimeDelegation(input, transport)).rejects.toMatchObject({ status: 403 })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-HTTPS or credential-bearing origin before contacting Kernel', async () => {
    const transport = vi.fn<typeof fetch>()
    for (const harnessOrigin of ['http://app.example.test', 'https://user:password@app.example.test', 'https://app.example.test/path']) {
      await expect(issueDesktopRuntimeDelegation({ ...input, harnessOrigin }, transport)).rejects.toThrow('HTTPS')
    }
    expect(transport).not.toHaveBeenCalled()
  })
})
