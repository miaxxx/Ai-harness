// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  moduleNavigationItems,
  renderDesktopApplicationPreviewPage,
} from './desktop-application-ui.ts'
import type {
  DesktopApplicationNavigationRecord,
  DesktopApplicationPreviewPageEnvelope,
} from './desktop-application-shared.ts'

function preview(layout: DesktopApplicationPreviewPageEnvelope['page']['layout']): DesktopApplicationPreviewPageEnvelope {
  return {
    preview: {
      id: 'preview_supplier_risk_r4',
      moduleId: 'supplier-risk',
      moduleVersion: '0.1.0',
      sourceRevision: 4,
      persona: 'employee',
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
    expect(host.textContent).toContain('Immutable governed preview')
  })

  it('fails closed for an unknown remote component instead of executing it', () => {
    const host = document.createElement('div')
    renderDesktopApplicationPreviewPage(host, preview({
      component: 'Page',
      children: [{ component: 'RemoteArbitraryReactBundle', props: { src: 'https://evil.invalid/app.js' } }],
    }))
    const refusal = host.querySelector('[data-component="RemoteArbitraryReactBundle"]')
    expect(refusal).not.toBeNull()
    expect(refusal?.textContent).toContain('UNSUPPORTED COMPONENT')
    expect(refusal?.textContent).toContain('refused to execute')
    expect(host.querySelector('script')).toBeNull()
  })

  it('blocks preview rendering when the design system is not supported by this Desktop build', () => {
    const host = document.createElement('div')
    const value = preview({ component: 'Page' })
    value.designSystem = { id: 'untrusted-design-system', version: '9.9.9' }
    renderDesktopApplicationPreviewPage(host, value)
    expect(host.textContent).toContain('Unsupported design system')
    expect(host.querySelector('.enterprise-application-canvas')).toBeNull()
  })
})
