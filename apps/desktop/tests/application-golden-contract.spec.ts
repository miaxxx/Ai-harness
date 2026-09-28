// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  moduleNavigationItems,
  renderDesktopApplicationPage,
  renderDesktopApplicationPreviewPage,
} from '../src/desktop-application-ui.ts'
import type {
  DesktopApplicationBridge,
  DesktopApplicationNavigationRecord,
  DesktopApplicationPageEnvelope,
  DesktopApplicationPreviewPageEnvelope,
} from '../src/desktop-application-shared.ts'

function preview(layout: DesktopApplicationPreviewPageEnvelope['page']['layout']): DesktopApplicationPreviewPageEnvelope {
  return {
    preview: {
      id: 'preview_supplier_risk_r4',
      moduleId: 'supplier-risk',
      moduleVersion: '0.1.0',
      sourceRevision: 4,
      persona: 'employee',
      workspace: {
        resourceId: 'obis-preview-supplier-risk-abc123',
        provider: 'remote',
        infrastructureBacked: true,
        runtimeEnvironmentId: 'k8s:obis-preview-supplier-risk-abc123',
        isolationKey: 'namespace/obis-preview-supplier-risk-abc123',
        namespace: 'obis-preview-supplier-risk-abc123',
        status: 'ready',
        expiresAt: '2026-09-19T18:00:00.000Z',
      },
    },
    module: { id: 'supplier-risk', version: '0.1.0', name: 'Supplier Risk' },
    page: {
      id: 'home',
      title: 'Supplier Risk',
      pattern: 'Master Detail',
      layout,
      source: { query: 'supplier.list' },
      actions: ['Supplier.changeRisk'],
    },
    designSystem: { id: 'obis-enterprise', version: '1.0.0' },
    permissions: {
      moduleId: 'supplier-risk',
      moduleVersion: '0.1.0',
      visible: true,
      executable: true,
      configurable: false,
      editable: false,
      administerable: false,
      reasons: ['preview-persona'],
    },
  }
}

describe('OBIS application golden contract', () => {
  it('projects published navigation into the dynamic Apps surface without static sidebar wiring', () => {
    const records: DesktopApplicationNavigationRecord[] = [{
      id: 'supplier-risk',
      label: 'Supplier Risk',
      page: 'home',
      group: 'procurement',
      moduleId: 'supplier-risk',
      moduleVersion: '0.1.0',
    }]
    expect(moduleNavigationItems(records)).toEqual([{
      id: 'module:supplier-risk:supplier-risk',
      label: 'Supplier Risk',
      kind: 'module',
      route: '/apps/supplier-risk/home',
      icon: 'blocks',
      section: 'procurement',
      order: 1000,
      moduleId: 'supplier-risk',
      modulePageId: 'home',
      moduleVersion: '0.1.0',
    }])
  })

  it('renders immutable Supplier Risk preview using only governed declarative components', () => {
    const host = document.createElement('div')
    renderDesktopApplicationPreviewPage(host, preview({
      component: 'Page',
      children: [{
        component: 'Grid',
        children: [
          { component: 'DataTable' },
          { component: 'ObjectDetail', children: [{ component: 'RiskIndicator' }] },
        ],
      }],
    }))
    expect(host.querySelector('[data-preview-id="preview_supplier_risk_r4"]')).not.toBeNull()
    expect(host.querySelector('[data-component="DataTable"]')).not.toBeNull()
    expect(host.querySelector('[data-component="RiskIndicator"]')).not.toBeNull()
    expect(host.textContent).toContain('Ephemeral governed preview workspace')
    expect(host.textContent).toContain('obis-preview-supplier-risk-abc123')
    expect(host.textContent).toContain('k8s:obis-preview-supplier-risk-abc123')
  })

  it('fails closed for an unknown remote component instead of executing it', () => {
    const host = document.createElement('div')
    renderDesktopApplicationPreviewPage(host, preview({
      component: 'Page',
      children: [{
        component: 'RemoteArbitraryReactBundle',
        props: { src: 'https://evil.invalid/app.js' },
      }],
    }))
    expect(host.textContent).toContain('RENDERER CONTRACT BLOCKED')
    expect(host.textContent).toContain('Unknown application component RemoteArbitraryReactBundle')
    expect(host.querySelector('script')).toBeNull()
  })

  it('blocks preview rendering when the design system is not supported by this Desktop build', () => {
    const host = document.createElement('div')
    const value = preview({ component: 'Page' })
    value.designSystem = { id: 'untrusted-design-system', version: '9.9.9' }
    renderDesktopApplicationPreviewPage(host, value)
    expect(host.textContent).toContain('RENDERER CONTRACT BLOCKED')
    expect(host.querySelector('.enterprise-application-canvas')).toBeNull()
  })

  it('fails closed for unknown shared tokens and patterns', () => {
    const host = document.createElement('div')
    const badToken = preview({ component: 'Page', tokenRefs: ['color.untrusted'] })
    renderDesktopApplicationPreviewPage(host, badToken)
    expect(host.textContent).toContain('RENDERER CONTRACT BLOCKED')
    expect(host.textContent).toContain('Unknown application design token')

    const badPattern = preview({ component: 'Page' })
    badPattern.page.pattern = 'Unregistered Infinite Canvas'
    renderDesktopApplicationPreviewPage(host, badPattern)
    expect(host.textContent).toContain('Unknown application pattern')
  })

  it('provides interactive parity for search, filter, tabs, disclosure, form and picker components', async () => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'home',
        title: 'Supplier Risk',
        pattern: 'Master Detail',
        source: { query: 'supplier.list' },
        layout: {
          component: 'Page',
          children: [
            { component: 'Search', props: { label: 'Search suppliers' } },
            { component: 'Filter', props: { field: 'risk', label: 'Risk' } },
            { component: 'DataTable' },
            { component: 'ObjectPicker', props: { field: 'name' } },
            {
              component: 'Tabs',
              children: [
                {
                  component: 'Section',
                  props: { label: 'Overview', description: 'Overview panel' },
                },
                {
                  component: 'Section',
                  props: { label: 'History', description: 'History panel' },
                },
              ],
            },
            {
              component: 'Drawer',
              props: { openLabel: 'Open details' },
              children: [{
                component: 'Section',
                props: { description: 'Drawer content' },
              }],
            },
            {
              component: 'Form',
              props: {
                title: 'Review',
                fields: [
                  { name: 'owner', label: 'Owner', type: 'text', required: true },
                  {
                    name: 'decision',
                    label: 'Decision',
                    options: ['approve', 'reject'],
                  },
                ],
              },
            },
          ],
        },
      },
      designSystem: { id: 'obis-enterprise', version: '1.0.0' },
      permissions: {
        moduleId: 'supplier-risk',
        moduleVersion: '1.0.0',
        visible: true,
        executable: false,
        configurable: false,
        editable: false,
        administerable: false,
        reasons: ['test'],
      },
      runtime: {
        query: {
          name: 'supplier.list',
          object: 'Supplier',
          fields: ['name', 'risk'],
          filterable: ['risk'],
          filters: { risk: { type: 'string' } },
        },
        actions: [],
      },
    }

    const bridge = {
      query: () => Promise.resolve({
        requestId: 'query-1',
        status: 'executed' as const,
        query: 'supplier.list',
        object: 'Supplier',
        decision: {
          allowed: true,
          matchedPolicies: ['supplier.read'],
          reason: 'Allowed',
        },
        items: [
          {
            id: 's1',
            object: 'Supplier',
            values: { name: 'Northwind', risk: 'low' },
            version: 1,
            createdAt: '2026-09-21T00:00:00Z',
            updatedAt: '2026-09-21T00:00:00Z',
          },
          {
            id: 's2',
            object: 'Supplier',
            values: { name: 'Contoso', risk: 'high' },
            version: 1,
            createdAt: '2026-09-21T00:00:00Z',
            updatedAt: '2026-09-21T00:00:00Z',
          },
        ],
        truncated: false,
        errors: [],
      }),
    } as unknown as DesktopApplicationBridge

    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge,
    })

    const search = host.querySelector<HTMLInputElement>('.enterprise-app-local-search input')
    expect(search).not.toBeNull()
    if (search) {
      search.value = 'Northwind'
      search.dispatchEvent(new Event('input', { bubbles: true }))
      const rows = host.querySelectorAll<HTMLTableRowElement>('tbody tr')
      expect(rows[0]?.hidden).toBe(false)
      expect(rows[1]?.hidden).toBe(true)
    }

    const filter = host.querySelector<HTMLSelectElement>('.enterprise-app-local-filter select')
    expect(filter?.querySelector('option[value="high"]')).not.toBeNull()

    const tabs = host.querySelectorAll<HTMLButtonElement>('.enterprise-app-tab-list button')
    expect(tabs.length).toBe(2)
    tabs[1]?.click()
    expect(host.textContent).toContain('History panel')

    const drawer = host.querySelector<HTMLButtonElement>('[data-component="Drawer"] button')
    expect(drawer?.getAttribute('aria-expanded')).toBe('false')
    drawer?.click()
    expect(drawer?.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('Drawer content')

    expect(host.querySelector('form[data-component="Form"] input[name="owner"]')).not.toBeNull()
    expect(host.querySelector('form[data-component="Form"] select[name="decision"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-component="ObjectPicker"] option').length).toBeGreaterThan(1)
  })
})
