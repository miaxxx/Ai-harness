// @vitest-environment jsdom
/** Snapshot the runnable Desktop composition with recorded preload responses and no model request. */
import { act, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { mountDesktopProduct } from '../src/product-runtime.ts'

it('assembles enterprise scope, released navigation and original conversation workspace together', async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() { /* JSDOM has no layout measurements. */ }
    unobserve() { /* JSDOM has no layout measurements. */ }
    disconnect() { /* JSDOM has no layout measurements. */ }
  })
  localStorage.clear()
  const tenant = { id: 'example', displayName: '示例企业', roles: ['employee'], projects: [
    { id: 'assets', tenantId: 'example', name: '设备管理', createdAt: '2026-10-13' },
  ], environments: [
    { id: 'development', tenantId: 'example', name: 'development', kind: 'development', status: 'active', createdAt: '2026-10-13' },
    { id: 'production', tenantId: 'example', name: 'production', kind: 'production', status: 'active', createdAt: '2026-10-13' },
  ] }
  const preferences = { userId: 'employee', pinnedIds: [], hiddenOptionalIds: [], navigationOrder: [],
    defaultProjectId: 'assets', defaultEnvironmentId: 'development', version: 1, updatedAt: '2026-10-13' }
  Object.defineProperty(window, 'dshEnterprise', { configurable: true, value: {
    status: async () => ({ configured: true, authenticated: true, user: { id: 'employee', displayName: '示例员工' } }),
    context: async () => ({ currentTenantId: 'example', tenants: [tenant] }), workspace: async () => ({ preferences }),
    validateRuntimeScope: async () => ({ projectId: 'assets', environmentId: 'development' }),
  } })
  Object.defineProperty(window, 'dshApplications', { configurable: true, value: {
    navigation: async () => [{ id: 'asset-register/home', label: '设备台账', moduleId: 'asset-register', moduleVersion: '0.1.0', page: 'home' }],
  } })
  Object.defineProperty(window, 'dshBusiness', { configurable: true, value: {
    setBounds: async () => {}, prepare: async () => {}, onSessionEnded: () => () => {}, hide: async () => {},
  } })
  Object.defineProperty(window, 'dshDesktop', { configurable: true, value: {
    restartRuntime: async () => {}, subscribe: () => () => {}, subscribePreviewRequest: () => () => {},
    subscribeAttachmentPaste: () => () => {}, workspace: async () => '/workspace/example', listSessions: async () => [],
    createSession: async () => 'example-session', loadSession: async () => {}, modelProfiles: async () => ({ profiles: [] }),
    listSkills: async () => [],
  } })
  const container = document.createElement('div')
  document.body.append(container)
  let dispose: (() => void) | undefined
  try {
    await act(async () => { dispose = await mountDesktopProduct(container) })
    await waitFor(() => { expect(container.querySelector('[aria-label="OBIS 工作区"]')).not.toBeNull() })
    const nav = container.querySelector('[aria-label="OBIS 工作区"]')
    expect(nav?.textContent?.replace(/\s+/g, ' ').trim()).toMatchSnapshot()
    expect(container.querySelector('[data-shell-chat-navigation]')).not.toBeNull()
    expect(container.querySelector('[data-shell-center]')).not.toBeNull()
  } finally {
    await act(async () => { dispose?.() })
    container.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
