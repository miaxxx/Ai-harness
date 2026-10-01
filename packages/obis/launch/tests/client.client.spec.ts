// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { apply, readObisLaunch, readObisPreviewLaunch } from '../src/client/index.ts'

const origin = 'http://127.0.0.1:5173'

function layout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    component: 'Form',
    id: 'leave-form',
    tokenRefs: ['color.accent'],
    props: {
      title: 'Leave',
      fields: [{ name: 'days', label: 'Days', type: 'number', required: true }],
      action: 'submit_leave',
    },
    ...overrides,
  }
}

const previewPage = {
  preview: { id: 'prev_1', moduleId: 'mod_leave', moduleVersion: '1.0.0', sourceRevision: 3, persona: 'employee' },
  module: { id: 'mod_leave', version: '1.0.0', name: 'Leave' },
  page: { id: 'home', title: 'Home', pattern: 'Object Detail', actions: ['submit_leave'], layout: layout() },
  designSystem: { id: 'obis-enterprise', version: '1.0.0' },
  access: {
    visible: true,
    executable: false,
    configurable: false,
    editable: false,
    administerable: false,
    reasons: [],
  },
}

const catalog = {
  projectId: 'proj_1',
  environmentId: 'prod',
  items: [{
    id: 'nav-home',
    label: 'Leave home',
    page: 'home',
    group: 'HR',
    moduleId: 'mod_leave',
    moduleVersion: '1.0.0',
  }],
}

const publishedPage = {
  module: { id: 'mod_leave', version: '1.0.0', name: 'Leave' },
  page: { id: 'home', title: 'Home', actions: ['submit_leave'], layout: layout() },
  designSystem: { id: 'obis-enterprise', version: '1.0.0' },
  permissions: {
    visible: true,
    executable: true,
    configurable: false,
    editable: false,
    administerable: false,
    reasons: [],
  },
}

function rpcOk(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}

function rpcErr(message: string): RpcResult<unknown> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function context(call: (channel: string, endpoint: string, payload: unknown) => Promise<RpcResult<unknown>>): Context {
  return {
    get(name: string) {
      if (name !== 'connection') return undefined
      return { rpc: { call } }
    },
  } as Context
}

afterEach(() => {
  document.body.innerHTML = ''
  document.getElementById('obis-application-preview-style')?.remove()
  sessionStorage.clear()
  location.hash = ''
  vi.restoreAllMocks()
})

describe('obis-launch client', () => {
  it('stays inert without a launch ticket', () => {
    const get = vi.fn()
    apply({ get } as unknown as Context)
    expect(get).not.toHaveBeenCalled()
    location.hash = '#obis-launch='
    apply({ get } as unknown as Context)
    expect(get).not.toHaveBeenCalled()
  })

  it('requires the client connection service', () => {
    location.hash = '#obis-launch=obwl_1'
    expect(() =>{  apply({ get: () => undefined } as unknown as Context) }).toThrow(/client connection service/)
  })

  it('strips the launch fragment, exchanges the ticket, and overlays the entitled catalog', async () => {
    location.hash = '#obis-launch=obwl_1&obis-base=https://evil.example&keep=1'
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      if (endpoint === 'catalog') return rpcOk(catalog)
      throw new Error(endpoint)
    })
    apply(context(call))
    await vi.waitFor(() => {
      expect(document.getElementById('obis-application-catalog')).toBeTruthy()
    })
    expect(location.hash).toBe('#keep=1')
    expect(call).toHaveBeenCalledWith('/obis-launch', 'exchange', { ticket: 'obwl_1', harnessOrigin: location.origin })
    expect(readObisLaunch()?.launch.projectId).toBe('proj_1')
    expect(readObisPreviewLaunch()).toBeUndefined()
    const item = document.querySelector('[data-module-id="mod_leave"]') as HTMLButtonElement
    expect(item).toBeTruthy()
    call.mockImplementation(async (_channel, endpoint) => {
      if (endpoint === 'module-page') return rpcOk(publishedPage)
      throw new Error(endpoint)
    })
    item.click()
    await vi.waitFor(() => {
      expect(document.getElementById('obis-application-page')).toBeTruthy()
    })
    expect(document.querySelector('[data-renderer-contract="obis-ui-runtime@0.1"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Submit binding: submit_leave')
    ;(document.querySelector('#obis-application-page .obis-preview-close') as HTMLButtonElement).click()
    expect(document.getElementById('obis-application-page')).toBeNull()
  })

  it('renders an empty catalog and closes when the backdrop is clicked', async () => {
    location.hash = '#obis-launch=obwl_1'
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      return rpcOk({ projectId: 'proj_1', environmentId: 'prod', items: [] })
    })
    apply(context(call))
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('No entitled published applications')
    })
    const backdrop = document.getElementById('obis-application-catalog')!
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.getElementById('obis-application-catalog')).toBeNull()
  })

  it('overlays a matching launch-bound preview, including hidden persona pages', async () => {
    location.hash = '#obis-launch=obwl_1'
    const hidden = {
      ...previewPage,
      page: {
        ...previewPage.page,
        layout: {
          component: 'Stack',
          children: [
            layout(),
            { component: 1 },
            { component: 'Note' },
            { component: 'Section', tokenRefs: [1] },
            { component: 'Section', tokenRefs: [] },
          ],
        },
      },
      access: { ...previewPage.access, visible: false, reasons: ['role'] },
    }
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'employee' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      if (endpoint === 'preview-page') return rpcOk(hidden)
      throw new Error(endpoint)
    })
    apply(context(call))
    await vi.waitFor(() => {
      expect(document.getElementById('obis-application-preview')).toBeTruthy()
    })
    expect(readObisPreviewLaunch()?.previewId).toBe('prev_1')
    expect(document.body.textContent).toContain('hidden for the simulated persona')
    expect(document.querySelector('[data-renderer-state="blocked"]')).toBeTruthy()
    expect(document.body.textContent).toContain('unavailable in the shared renderer contract')
    await vi.waitFor(() => {
      expect(document.getElementById('obis-application-preview-style')).toBeTruthy()
    })
    apply(context(call))
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#obis-application-preview-style')).toHaveLength(1)
    })
  })

  it('reports preview, catalog, page and exchange failures without exposing tokens', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    location.hash = '#obis-launch=obwl_1'
    const failed = vi.fn(async () => rpcErr('nope'))
    apply(context(failed))
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled()
    })
    expect(readObisLaunch()).toBeUndefined()

    location.hash = '#obis-launch=obwl_2'
    const previewFail = vi.fn(async (_c: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'employee' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      return rpcErr('preview down')
    })
    apply(context(previewFail))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[0]).includes('application preview failed'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_3'
    const catalogFail = vi.fn(async (_c: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      return rpcErr('catalog down')
    })
    apply(context(catalogFail))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[0]).includes('published catalog failed'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_4'
    const pageFail = vi.fn(async (_c: string, endpoint: string, payload: unknown) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      if (endpoint === 'catalog') return rpcOk({ ...catalog, items: [{ ...catalog.items[0], group: undefined }] })
      expect(payload).toEqual({ moduleId: 'mod_leave', pageId: 'home' })
      return rpcErr('page down')
    })
    apply(context(pageFail))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-module-id="mod_leave"]')).toBeTruthy()
    })
    ;(document.querySelector('[data-module-id="mod_leave"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[0]).includes('published application page failed'))).toBe(true)
    })
  })

  it('rejects preview and catalog envelopes that do not match the launch or schema', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    location.hash = '#obis-launch=obwl_1'
    const mismatch = vi.fn(async (_c: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'employee' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      return rpcOk({ ...previewPage, preview: { ...previewPage.preview, id: 'other' } })
    })
    apply(context(mismatch))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('did not match the launch-bound preview'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_2'
    const badCatalog = vi.fn(async (_c: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      return rpcOk({ projectId: 'proj_1', environmentId: 'prod', items: [{ id: 'x' }] })
    })
    apply(context(badCatalog))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('invalid navigation item'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_3'
    const badPage = vi.fn(async (_c: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      if (endpoint === 'catalog') return rpcOk(catalog)
      return rpcOk({ ...publishedPage, module: { ...publishedPage.module, id: 'other' } })
    })
    apply(context(badPage))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-module-id="mod_leave"]')).toBeTruthy()
    })
    ;(document.querySelector('[data-module-id="mod_leave"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('did not match the catalog item'))).toBe(true)
    })
  })

  it('renders visible preview and hidden published pages and rejects invalid envelopes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    location.hash = '#obis-launch=obwl_visible'
    const visible = vi.fn(async (_c: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'manager' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      return rpcOk({
        ...previewPage,
        preview: { ...previewPage.preview, persona: 'manager' },
      })
    })
    apply(context(visible))
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Read-only preview')
    })

    location.hash = '#obis-launch=obwl_hidden_page'
    const hiddenPage = vi.fn(async (_c: string, endpoint: string) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      if (endpoint === 'catalog') return rpcOk(catalog)
      return rpcOk({
        ...publishedPage,
        permissions: { ...publishedPage.permissions, visible: false, reasons: ['hidden'] },
      })
    })
    apply(context(hiddenPage))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-module-id="mod_leave"]')).toBeTruthy()
    })
    ;(document.querySelector('[data-module-id="mod_leave"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('hidden for the current identity')
    })

    location.hash = '#obis-launch=obwl_access'
    apply(context(async (_c, endpoint) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'auditor' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      return rpcOk({ ...previewPage, preview: { ...previewPage.preview, persona: 'auditor' }, access: { visible: true } })
    }))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('invalid entitlement decision'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_page'
    apply(context(async (_c, endpoint) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'developer' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      return rpcOk({ ...previewPage, preview: { ...previewPage.preview, persona: 'developer' }, page: { id: 'home' } })
    }))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('invalid page envelope'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_persona'
    apply(context(async (_c, endpoint) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'employee' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      return rpcOk({ ...previewPage, preview: { ...previewPage.preview, persona: 'nope' } })
    }))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('invalid page envelope'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_module'
    apply(context(async (_c, endpoint) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      if (endpoint === 'catalog') return rpcOk(catalog)
      return rpcOk({ ...publishedPage, module: { id: 'mod_leave', version: '1.0.0' } })
    }))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-module-id="mod_leave"]')).toBeTruthy()
    })
    ;(document.querySelector('[data-module-id="mod_leave"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('invalid page envelope'))).toBe(true)
    })
  })

  it('stringifies non-Error launch failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    location.hash = '#obis-launch=obwl_boom'
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tests non-Error wire failure normalization.
    apply(context(async () => Promise.reject('boom')))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('boom'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_preview_boom'
    apply(context(async (_c, endpoint) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: {
            id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'read-only',
            preview: { projectId: 'proj_1', previewId: 'prev_1', pageId: 'home', persona: 'employee' },
            createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z',
          },
        })
      }
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tests non-Error wire failure normalization.
      return Promise.reject('preview-boom')
    }))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('preview-boom'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_catalog_boom'
    apply(context(async (_c, endpoint) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tests non-Error wire failure normalization.
      return Promise.reject('catalog-boom')
    }))
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('catalog-boom'))).toBe(true)
    })

    location.hash = '#obis-launch=obwl_page_boom'
    apply(context(async (_c, endpoint) => {
      if (endpoint === 'exchange') {
        return rpcOk({
          access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
          launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', projectId: 'proj_1', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
        })
      }
      if (endpoint === 'catalog') return rpcOk(catalog)
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tests non-Error wire failure normalization.
      return Promise.reject('page-boom')
    }))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-module-id="mod_leave"]')).toBeTruthy()
    })
    ;(document.querySelector('[data-module-id="mod_leave"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(error.mock.calls.some(call => String(call[1]).includes('page-boom'))).toBe(true)
    })
  })

  it('persists launch metadata when sessionStorage is writable and ignores quota failure', async () => {
    expect(readObisLaunch()).toBeUndefined()
    sessionStorage.setItem('dsh.obisLaunch', '{')
    expect(readObisLaunch()).toBeUndefined()
    const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    location.hash = '#obis-launch=obwl_1'
    apply(context(async () => rpcOk({
      access: { sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z' },
      launch: { id: 'l', tenantId: 't', userId: 'u', environmentId: 'prod', harnessOrigin: origin, autonomy: 'human-approved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:02:00.000Z' },
    })))
    await vi.waitFor(() => {
      expect(quota).toHaveBeenCalled()
    })
  })
})
