import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import ObisLaunchService, { name } from '../src/index.ts'

class FakeCredentials {
  readonly values = new Map<string, string>()

  async resolve(ref: string): Promise<{ value: string; source: string } | undefined> {
    const value = this.values.get(String(ref))
    return value === undefined ? undefined : { value, source: 'test' }
  }

  async set(ref: string, value: string): Promise<void> {
    this.values.set(String(ref), value)
  }

  clear(): void {
    this.values.clear()
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
}

const origin = 'http://127.0.0.1:5173'

function launchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'launch_1',
    tenantId: 'tenant_1',
    userId: 'user_1',
    environmentId: 'prod',
    projectId: 'proj_1',
    harnessOrigin: origin,
    autonomy: 'human-approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:02:00.000Z',
    ...overrides,
  }
}

function exchangeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access: { sessionId: 'sess_1', accessToken: 'obdt_token', expiresAt: '2099-01-01T00:00:00.000Z' },
    launch: launchRow(overrides),
  }
}

const navigation = {
  items: [
    {
      id: 'nav-home',
      label: 'Leave home',
      page: 'home',
      group: 'HR',
      moduleId: 'mod_leave',
      moduleVersion: '1.0.0',
    },
  ],
}

const publishedPage = {
  module: { id: 'mod_leave', version: '1.0.0', name: 'Leave' },
  page: { id: 'home', title: 'Home', layout: { component: 'Page' } },
  designSystem: { id: 'ds', version: '1' },
  permissions: {
    visible: true,
    executable: true,
    configurable: false,
    editable: false,
    administerable: false,
    reasons: [],
  },
}

async function boot(config: { baseUrl?: string; credentialRef?: string; deviceId?: string }, fetchImpl: typeof fetch): Promise<{
  service: ObisLaunchService
  credentials: FakeCredentials
  rpc: ConnectionRpcHandler | undefined
  dispose: () => Promise<void>
}> {
  vi.stubGlobal('fetch', fetchImpl)
  const credentials = new FakeCredentials()
  let rpc: ConnectionRpcHandler | undefined
  const ctx = new Context()
  ctx.provide('credentials', credentials)
  ctx.provide('connection', {
    rpc: {
      handle(_channel, handler) {
        rpc = handler
        return async () => { rpc = undefined }
      },
      intercept() {
        throw new Error('launch tests do not use /api intercept')
      },
    },
  } satisfies HostConnectionHandle)
  const fiber = ctx.plugin(ObisLaunchService, {
    baseUrl: config.baseUrl ?? '',
    credentialRef: config.credentialRef ?? 'OBIS_DELEGATED_ACCESS_TOKEN',
    deviceId: config.deviceId ?? '',
  })
  await fiber.await()
  return {
    service: ctx.obisLaunch,
    credentials,
    rpc,
    dispose: () => fiber.dispose(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('obis-launch host', () => {
  it('exports the plugin name and stays inert without a kernel baseUrl', async () => {
    expect(name).toBe('obis-launch')
    const started = await boot({ baseUrl: '' }, vi.fn())
    expect(started.rpc).toBeUndefined()
    expect(started.service.snapshot()).toBeUndefined()
    expect(started.service.tokenReference()).toBe('OBIS_DELEGATED_ACCESS_TOKEN')
    await started.dispose()
  })

  it('rejects kernel baseUrl values that are not loopback HTTP or HTTPS', () => {
    const ctx = new Context()
    ctx.provide('credentials', new FakeCredentials())
    ctx.provide('connection', { rpc: { handle: () => async () => {}, intercept: () => async () => {} } } satisfies HostConnectionHandle)
    expect(() => new ObisLaunchService(ctx, { baseUrl: 'http://example.com', deviceId: '' })).toThrow(/HTTPS unless it is loopback/)
    const ctx2 = new Context()
    ctx2.provide('credentials', new FakeCredentials())
    ctx2.provide('connection', { rpc: { handle: () => async () => {}, intercept: () => async () => {} } } satisfies HostConnectionHandle)
    expect(() => new ObisLaunchService(ctx2, { baseUrl: 'https://user:pass@kernel.example', deviceId: '' })).toThrow(/credentials, query parameters or fragments/)
    const ctx3 = new Context()
    ctx3.provide('credentials', new FakeCredentials())
    ctx3.provide('connection', { rpc: { handle: () => async () => {}, intercept: () => async () => {} } } satisfies HostConnectionHandle)
    expect(() => new ObisLaunchService(ctx3, { baseUrl: 'https://kernel.example/?q=1', deviceId: '' })).toThrow(/credentials, query parameters or fragments/)
    const ctx4 = new Context()
    ctx4.provide('credentials', new FakeCredentials())
    ctx4.provide('connection', { rpc: { handle: () => async () => {}, intercept: () => async () => {} } } satisfies HostConnectionHandle)
    expect(() => new ObisLaunchService(ctx4, { baseUrl: 'https://kernel.example/#x', deviceId: '' })).toThrow(/credentials, query parameters or fragments/)
    const ctx5 = new Context()
    ctx5.provide('credentials', new FakeCredentials())
    ctx5.provide('connection', { rpc: { handle: () => async () => {}, intercept: () => async () => {} } } satisfies HostConnectionHandle)
    expect(() => new ObisLaunchService(ctx5, { baseUrl: 'https://kernel.example/', deviceId: '' })).not.toThrow()
    const ctx6 = new Context()
    ctx6.provide('credentials', new FakeCredentials())
    ctx6.provide('connection', { rpc: { handle: () => async () => {}, intercept: () => async () => {} } } satisfies HostConnectionHandle)
    expect(() => new ObisLaunchService(ctx6, { baseUrl: 'http://localhost:8080', deviceId: '' })).not.toThrow()
    const ctx7 = new Context()
    ctx7.provide('credentials', new FakeCredentials())
    ctx7.provide('connection', { rpc: { handle: () => async () => {}, intercept: () => async () => {} } } satisfies HostConnectionHandle)
    expect(() => new ObisLaunchService(ctx7, { baseUrl: 'http://[::1]:8080', deviceId: '' })).not.toThrow()
  })

  it('exchanges a ticket, stores the delegated token, and omits the secret from the RPC result', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ ticket: 'obwl_1', harnessOrigin: origin, deviceId: 'dev-1' })
      return jsonResponse(200, exchangeBody({ goal: 'Review leave', consumedAt: '2026-01-01T00:01:00.000Z' }))
    })
    const started = await boot({ baseUrl: 'http://127.0.0.1:8080', deviceId: 'dev-1' }, fetchImpl as unknown as typeof fetch)
    const result = await started.rpc!('exchange', { ticket: 'obwl_1', harnessOrigin: origin }, new AbortController().signal)
    expect(result).toEqual({
      ok: true,
      value: {
        access: { sessionId: 'sess_1', expiresAt: '2099-01-01T00:00:00.000Z' },
        launch: launchRow({ goal: 'Review leave', consumedAt: '2026-01-01T00:01:00.000Z' }),
      },
    })
    expect(started.credentials.values.get('OBIS_DELEGATED_ACCESS_TOKEN')).toBe('obdt_token')
    expect(started.service.snapshot()?.goal).toBe('Review leave')
    started.service.snapshot()!.goal = 'mutated'
    expect(started.service.snapshot()?.goal).toBe('Review leave')
    await started.dispose()
  })

  it('rejects incomplete exchange payloads and unknown endpoints', async () => {
    const started = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn())
    expect(await started.rpc!('exchange', { ticket: '', harnessOrigin: origin }, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect(await started.rpc!('exchange', { harnessOrigin: origin }, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect(await started.rpc!('exchange', { ticket: 'x', harnessOrigin: 1 }, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect(await started.rpc!('nope', {}, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { message: 'Unknown OBIS launch endpoint nope.' },
    })
    await started.dispose()
  })

  it('maps kernel exchange failures, invalid envelopes, origin mismatch and non-Error fetch rejection', async () => {
    const signal = new AbortController().signal
    const started = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async () => jsonResponse(401, { error: { message: 'ticket spent' } })) as unknown as typeof fetch)
    expect(await started.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'ticket spent' },
    })
    await started.dispose()

    const fallback = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async () => textResponse(503, 'nope')) as unknown as typeof fetch)
    expect(await fallback.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS launch exchange failed with 503.' },
    })
    await fallback.dispose()

    const invalid = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async () => jsonResponse(200, { access: {} })) as unknown as typeof fetch)
    expect(await invalid.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace launch exchange returned an invalid payload.' },
    })
    await invalid.dispose()

    const mismatch = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({ harnessOrigin: 'http://127.0.0.1:9' }))) as unknown as typeof fetch,
    )
    expect(await mismatch.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS launch exchange returned a different Harness origin than requested.' },
    })
    await mismatch.dispose()

    const rejected = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async () => Promise.reject('kernel down')) as unknown as typeof fetch)
    expect(await rejected.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'kernel down' },
    })
    await rejected.dispose()
  })

  it('rejects invalid preview metadata and autonomy on exchange', async () => {
    const signal = new AbortController().signal
    const preview = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({ preview: [] }))) as unknown as typeof fetch,
    )
    expect(await preview.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace launch preview metadata is invalid.' },
    })
    await preview.dispose()

    const previewFields = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({ preview: { projectId: 1, previewId: 'p', pageId: 'h', persona: 'employee' } }))) as unknown as typeof fetch,
    )
    expect(await previewFields.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace launch preview metadata is invalid.' },
    })
    await previewFields.dispose()

    const emptyId = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({ id: '' }))) as unknown as typeof fetch,
    )
    expect(await emptyId.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace launch exchange returned an invalid payload.' },
    })
    await emptyId.dispose()

    const accessTypes = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, {
        access: { sessionId: 1, accessToken: 't', expiresAt: 'e' },
        launch: launchRow(),
      })) as unknown as typeof fetch,
    )
    expect(await accessTypes.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace launch exchange returned an invalid payload.' },
    })
    await accessTypes.dispose()

    const autonomy = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({ autonomy: 'nope' }))) as unknown as typeof fetch,
    )
    expect(await autonomy.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace launch exchange returned an invalid payload.' },
    })
    await autonomy.dispose()
  })

  it('loads a launch-bound preview page and refuses caller-selected preview identifiers', async () => {
    const signal = new AbortController().signal
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/v1/workspace-launches/exchange')) {
        return jsonResponse(200, exchangeBody({
          autonomy: 'read-only',
          preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'employee' },
        }))
      }
      expect(href).toContain('/v1/application/previews/prev_1/pages/home')
      return jsonResponse(200, { ok: true })
    })
    const started = await boot({ baseUrl: 'http://127.0.0.1:8080' }, fetchImpl as unknown as typeof fetch)
    expect(await started.rpc!('preview-page', { previewId: 'other' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'preview-page does not accept caller-selected preview identifiers.' },
    })
    expect(await started.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await started.rpc!('preview-page', undefined, signal)).toEqual({ ok: true, value: { ok: true } })
    expect(await started.rpc!('preview-page', {}, signal)).toEqual({ ok: true, value: { ok: true } })
    await started.dispose()
  })

  it('refuses preview-page unless the launch is a read-only preview with a delegated token', async () => {
    const signal = new AbortController().signal
    const ordinary = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody())) as unknown as typeof fetch,
    )
    expect(await ordinary.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await ordinary.rpc!('preview-page', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'The current OBIS launch is not an application preview.' },
    })
    await ordinary.dispose()

    const writable = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({
        autonomy: 'human-approved',
        preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'manager' },
      }))) as unknown as typeof fetch,
    )
    expect(await writable.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await writable.rpc!('preview-page', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'Application preview launches must remain read-only.' },
    })
    await writable.dispose()

    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/workspace-launches/exchange')) {
        return jsonResponse(200, exchangeBody({
          autonomy: 'read-only',
          preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'auditor' },
        }))
      }
      return jsonResponse(409, { error: { message: 'preview missing' } })
    })
    const missingCred = await boot({ baseUrl: 'http://127.0.0.1:8080' }, fetchImpl as unknown as typeof fetch)
    expect(await missingCred.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    missingCred.credentials.clear()
    expect(await missingCred.rpc!('preview-page', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'The delegated OBIS launch credential is unavailable.' },
    })
    missingCred.credentials.values.set('OBIS_DELEGATED_ACCESS_TOKEN', 'obdt_token')
    expect(await missingCred.rpc!('preview-page', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'preview missing' },
    })
    await missingCred.dispose()

    const fallback = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/workspace-launches/exchange')) {
        return jsonResponse(200, exchangeBody({
          autonomy: 'read-only',
          preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'developer' },
        }))
      }
      return textResponse(500, 'x')
    }) as unknown as typeof fetch)
    expect(await fallback.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await fallback.rpc!('preview-page', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS application preview failed with 500.' },
    })
    await fallback.dispose()
  })

  it('loads the launch-bound published catalog and refuses caller-selected scope', async () => {
    const signal = new AbortController().signal
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      expect(href).toContain('/v1/workspace/navigation?projectId=proj_1&environmentId=prod')
      return jsonResponse(200, navigation)
    })
    const started = await boot({ baseUrl: 'http://127.0.0.1:8080' }, fetchImpl as unknown as typeof fetch)
    expect(await started.rpc!('catalog', { projectId: 'other' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'catalog does not accept caller-selected project or environment identifiers.' },
    })
    expect(await started.rpc!('catalog', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'No OBIS workspace launch has been exchanged.' },
    })
    expect(await started.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await started.rpc!('catalog', undefined, signal)).toEqual({
      ok: true,
      value: { projectId: 'proj_1', environmentId: 'prod', items: navigation.items },
    })
    await started.dispose()
  })

  it('refuses published catalog for preview launches, missing projectId, and invalid navigation', async () => {
    const signal = new AbortController().signal
    const preview = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({
        autonomy: 'read-only',
        preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'employee' },
      }))) as unknown as typeof fetch,
    )
    expect(await preview.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await preview.rpc!('catalog', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'Published module catalog is unavailable for application preview launches.' },
    })
    await preview.dispose()

    const missingProject = await boot(
      { baseUrl: 'http://127.0.0.1:8080' },
      vi.fn(async () => jsonResponse(200, exchangeBody({ projectId: '' }))) as unknown as typeof fetch,
    )
    expect(await missingProject.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await missingProject.rpc!('catalog', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'The current OBIS launch is missing projectId required for published module catalog.' },
    })
    await missingProject.dispose()

    const invalid = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      return jsonResponse(200, { items: [{ id: 'x' }] })
    }) as unknown as typeof fetch)
    expect(await invalid.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await invalid.rpc!('catalog', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace navigation returned an invalid catalog item.' },
    })
    await invalid.dispose()

    const envelope = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      return jsonResponse(200, [])
    }) as unknown as typeof fetch)
    expect(await envelope.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await envelope.rpc!('catalog', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace navigation returned an invalid catalog.' },
    })
    await envelope.dispose()

    const httpErr = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      return jsonResponse(403, { error: { message: 'hidden' } })
    }) as unknown as typeof fetch)
    expect(await httpErr.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await httpErr.rpc!('catalog', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'hidden' },
    })
    await httpErr.dispose()

    const fallback = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      return textResponse(404, 'x')
    }) as unknown as typeof fetch)
    expect(await fallback.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await fallback.rpc!('catalog', undefined, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS workspace navigation failed with 404.' },
    })
    await fallback.dispose()
  })

  it('loads a module page only when the pair is in the launch-bound catalog', async () => {
    const signal = new AbortController().signal
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      if (href.includes('/v1/workspace/navigation?')) return jsonResponse(200, navigation)
      expect(href).toContain('/v1/workspace/modules/mod_leave/pages/home?projectId=proj_1&environmentId=prod')
      return jsonResponse(200, publishedPage)
    })
    const started = await boot({ baseUrl: 'http://127.0.0.1:8080' }, fetchImpl as unknown as typeof fetch)
    expect(await started.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(started.service.applicationModuleId()).toBeUndefined()
    expect(await started.rpc!('module-page', { moduleId: 'mod_leave' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'module-page requires launch-bound moduleId and pageId only.' },
    })
    expect(await started.rpc!('module-page', { moduleId: 1, pageId: 'home' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'module-page requires launch-bound moduleId and pageId only.' },
    })
    expect(await started.rpc!('module-page', { moduleId: 'mod_leave', pageId: 'home', extra: '1' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'module-page requires launch-bound moduleId and pageId only.' },
    })
    expect(await started.rpc!('module-page', { moduleId: 'other', pageId: 'home' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'Requested module page is not in the launch-bound entitled catalog.' },
    })
    expect(await started.rpc!('module-page', { moduleId: 'mod_leave', pageId: 'home' }, signal)).toEqual({
      ok: true,
      value: publishedPage,
    })
    expect(started.service.applicationModuleId()).toBe('mod_leave')
    expect(started.service.snapshot()).not.toHaveProperty('applicationModuleId')
    await started.dispose()

    const pageErr = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      if (href.includes('/v1/workspace/navigation?')) return jsonResponse(200, { items: [{ ...navigation.items[0], group: undefined }] })
      return jsonResponse(409, { error: { message: 'not visible' } })
    }) as unknown as typeof fetch)
    expect(await pageErr.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await pageErr.rpc!('module-page', { moduleId: 'mod_leave', pageId: 'home' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'not visible' },
    })
    expect(pageErr.service.applicationModuleId()).toBeUndefined()
    await pageErr.dispose()

    const fallback = await boot({ baseUrl: 'http://127.0.0.1:8080' }, vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/v1/workspace-launches/exchange')) return jsonResponse(200, exchangeBody())
      if (href.includes('/v1/workspace/navigation?')) return jsonResponse(200, navigation)
      return textResponse(500, 'x')
    }) as unknown as typeof fetch)
    expect(await fallback.rpc!('exchange', { ticket: 'x', harnessOrigin: origin }, signal)).toMatchObject({ ok: true })
    expect(await fallback.rpc!('module-page', { moduleId: 'mod_leave', pageId: 'home' }, signal)).toMatchObject({
      ok: false,
      error: { message: 'OBIS application page failed with 500.' },
    })
    await fallback.dispose()
  })
})
