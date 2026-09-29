import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, readObisLaunch, readObisPreviewLaunch } from '../src/client/index.ts'

describe('obis-launch client without a browser location', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not touch connection or session storage', () => {
    expect(readObisLaunch()).toBeUndefined()
    expect(readObisPreviewLaunch()).toBeUndefined()
    apply({ get: () => { throw new Error('connection must not be read') } } as never)
  })

  it('exchanges a ticket without dispatching browser events when window is absent', async () => {
    vi.stubGlobal('location', {
      hash: '#obis-launch=obwl_1',
      origin: 'http://127.0.0.1:5173',
      pathname: '/',
      search: '',
    })
    vi.stubGlobal('history', { state: null, replaceState() {} })
    const call = vi.fn(async () => ({
      ok: true,
      value: {
        access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
        launch: {
          id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: 'http://127.0.0.1:5173',
          autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
        },
      },
    }))
    apply({ get: () => ({ rpc: { call } }) } as never)
    await vi.waitFor(() => {
      expect(call).toHaveBeenCalled()
    })
    expect(readObisLaunch()).toBeUndefined()
  })

  it('records launch failure without dispatching window events', async () => {
    vi.stubGlobal('location', {
      hash: '#obis-launch=obwl_1',
      origin: 'http://127.0.0.1:5173',
      pathname: '/',
      search: '',
    })
    vi.stubGlobal('history', { state: null, replaceState() {} })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const call = vi.fn(async () => ({ ok: false, error: { code: 'internal', message: 'nope', details: {} } }))
    apply({ get: () => ({ rpc: { call } }) } as never)
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled()
    })
  })
})
