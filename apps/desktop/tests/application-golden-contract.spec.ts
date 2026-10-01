// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

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
    expect(host.querySelector('[data-renderer-contract="obis-ui-runtime@0.1"]')).not.toBeNull()
    expect(host.querySelector('[data-component="DataTable"]')).not.toBeNull()
    expect(host.querySelector('[data-component="RiskIndicator"]')).not.toBeNull()
    expect(host.textContent).toContain('Ephemeral governed preview workspace')
    expect(host.textContent).toContain('obis-preview-supplier-risk-abc123')
    expect(host.textContent).toContain('k8s:obis-preview-supplier-risk-abc123')
  })

  it('does not stamp FileViewer or KnowledgeSearch host mounts on preview', () => {
    const host = document.createElement('div')
    renderDesktopApplicationPreviewPage(host, preview({
      component: 'Page',
      children: [
        { component: 'FileViewer' },
        { component: 'KnowledgeSearch' },
      ],
    }))
    expect(host.querySelector('[data-page-files]')).toBeNull()
    expect(host.querySelector('[data-page-knowledge]')).toBeNull()
    expect(host.textContent).toContain('File open is supplied by the host adapter.')
    expect(host.textContent).toContain('Knowledge search is supplied by the host adapter.')
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

  it('renders the shared UI runtime component registry on a production page', async () => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'ops',
        title: 'Operations',
        pattern: 'Operations Console',
        source: { query: 'supplier.list' },
        actions: ['Supplier.changeRisk'],
        layout: {
          component: 'Page',
          children: [
            { component: 'MetricCard', props: { title: 'Open rows', aggregation: 'count' } },
            { component: 'MetricCard', props: { title: 'Spend', aggregation: 'sum', valueField: 'spend' } },
            { component: 'TaskList', props: { titleField: 'name', statusField: 'risk' } },
            { component: 'ApprovalQueue', props: { title: 'Approvals' } },
            { component: 'FileViewer', props: { nameField: 'name', mimeField: 'risk', sizeField: 'spend' } },
            { component: 'KnowledgeSearch', props: { titleField: 'name', snippetField: 'risk', citationField: 'owner' } },
            { component: 'ActionButton', props: { action: 'Supplier.changeRisk', label: 'Change risk' } },
            { component: 'WorkflowStatus', props: { statusField: 'risk' } },
            { component: 'NotificationPanel', props: { titleField: 'name', bodyField: 'risk', severityField: 'risk' } },
            { component: 'AIAssistant', props: { prompt: 'Ask about suppliers' } },
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
          fields: ['name', 'risk', 'spend'],
          filterable: ['risk'],
          filters: { risk: { type: 'string' } },
        },
        actions: [{
          name: 'Supplier.changeRisk',
          target: 'Supplier',
          risk: 'medium',
          input: { risk: { type: 'string', required: true } },
        }],
      },
    }

    let actionCalls = 0
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
            values: { name: 'Northwind', risk: 'low', spend: 10, owner: 'Procurement' },
            version: 1,
            createdAt: '2026-09-21T00:00:00Z',
            updatedAt: '2026-09-21T00:00:00Z',
          },
          {
            id: 's2',
            object: 'Supplier',
            values: { name: 'Contoso', risk: 'high', spend: 30, owner: 'Finance' },
            version: 1,
            createdAt: '2026-09-21T00:00:00Z',
            updatedAt: '2026-09-21T00:00:00Z',
          },
        ],
        truncated: false,
        errors: [],
      }),
      action: async () => {
        actionCalls += 1
        throw new Error('layout ActionButton must not execute')
      },
      tasks: async () => ({ items: [] }),
      approvalInbox: async () => ({ waitingForMe: [] }),
      searchKnowledge: async (input: { environmentId: string; query: string }) => {
        expect(input.environmentId).toBe('prod')
        expect(input.query).toBe('Operations')
        return {
          items: [{
            id: 'doc-1',
            title: 'Owned policy',
            content: 'Public excerpt',
            citation: 'handbook#1',
            version: 1,
            updatedAt: '2026-09-30T00:00:00.000Z',
          }],
        }
      },
    } as unknown as DesktopApplicationBridge

    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge,
    })

    expect(host.querySelector('[data-renderer-contract="obis-ui-runtime@0.1"]')).not.toBeNull()
    const metrics = [...host.querySelectorAll('[data-component="MetricCard"]')].map(node => node.textContent ?? '')
    expect(metrics.some(text => text.includes('Open rows') && text.includes('2'))).toBe(true)
    expect(metrics.some(text => text.includes('Spend') && text.includes('40'))).toBe(true)
    expect(host.querySelector('[data-component="TaskList"]')?.textContent).toContain('Northwind')
    expect(host.querySelector('[data-page-inbox="tasks"]')?.textContent).toContain('No entitled tasks are waiting in this environment.')
    expect(host.querySelector('[data-page-inbox="approvals"]')?.textContent).toContain('No entitled approvals are waiting in this environment.')
    expect(host.querySelector('[data-page-files]')?.textContent).toContain('Contoso')
    expect(host.querySelector('[data-page-knowledge]')?.textContent).toContain('Owned policy')
    expect(host.querySelector('[data-component="KnowledgeSearch"]')?.textContent).not.toContain('Procurement')
    expect(host.querySelector('[data-component="ActionButton"]')?.textContent).toContain('Action binding: Supplier.changeRisk')
    expect(host.querySelector<HTMLButtonElement>('[data-component="ActionButton"] button')?.disabled).toBe(true)
    expect(host.querySelector('[data-component="WorkflowStatus"]')?.textContent).toContain('high')
    expect(host.querySelector('[data-component="NotificationPanel"]')?.textContent).toContain('low')
    expect(host.querySelector('[data-component="AIAssistant"] textarea')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('[data-component="ActionButton"] button')?.click()
    expect(actionCalls).toBe(0)
  })

  it('hydrates entitled Task and Approval inboxes without inventing authority from query rows', async () => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'ops',
        title: 'Operations',
        pattern: 'Operations Console',
        layout: {
          component: 'Page',
          children: [
            { component: 'TaskList', props: { title: 'My tasks' } },
            { component: 'ApprovalQueue', props: { title: 'Approvals' } },
          ],
        },
      },
      designSystem: { id: 'obis-enterprise', version: '1.0.0' },
      permissions: {
        moduleId: 'supplier-risk',
        moduleVersion: '1.0.0',
        visible: true,
        executable: true,
        configurable: false,
        editable: false,
        administerable: false,
        reasons: ['test'],
      },
      runtime: { actions: [] },
    }
    let taskCalls = 0
    let approvalCalls = 0
    let transitionCalls = 0
    let decisionCalls = 0
    let decided = false
    const bridge = {
      tasks: async () => {
        taskCalls += 1
        return {
          items: [{
            id: 'task-1',
            title: 'Review supplier',
            status: taskCalls === 1 ? 'open' : 'running',
            priority: 'high',
            version: taskCalls,
            assignee: { type: 'user', id: 'user-1' },
          }],
        }
      },
      approvalInbox: async () => {
        approvalCalls += 1
        return {
          waitingForMe: decided
            ? []
            : [{
              id: 'appr-inbox-1',
              requestId: 'req-1',
              action: 'Supplier.changeRisk',
              gate: 'risk-review',
              status: 'pending',
              version: 1,
              requesterId: 'user-1',
              updatedAt: '2026-09-30T00:00:00.000Z',
              currentStage: { id: 'manager', name: 'Manager', quorum: 1, approvals: 0, rejections: 0 },
            }],
        }
      },
      transitionTask: async (input: { taskId: string; status: string; expectedVersion: number }) => {
        transitionCalls += 1
        expect(input.taskId).toBe('task-1')
        expect(input.status).toBe('running')
        expect(input.expectedVersion).toBe(1)
        return {
          id: 'task-1',
          title: 'Review supplier',
          status: 'running',
          priority: 'high',
          version: 2,
        }
      },
      decideApproval: async (input: { approvalId: string; decision: string; expectedVersion: number }) => {
        decisionCalls += 1
        decided = true
        expect(input.approvalId).toBe('appr-inbox-1')
        expect(input.decision).toBe('approve')
        expect(input.expectedVersion).toBe(1)
        return {
          id: 'appr-inbox-1',
          status: 'approved' as const,
          version: 2,
          action: 'Supplier.changeRisk',
          gate: 'risk-review',
          requesterId: 'user-1',
          updatedAt: '2026-09-30T00:00:00.000Z',
          currentStage: { id: 'manager', name: 'Manager', quorum: 1, approvals: 1, rejections: 0 },
        }
      },
    } as unknown as DesktopApplicationBridge

    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge,
    })

    const tasks = host.querySelector('[data-page-inbox="tasks"]')
    expect(tasks?.textContent).toContain('Review supplier')
    const approvals = host.querySelector('[data-page-inbox="approvals"]')
    expect(approvals?.textContent).toContain('Supplier.changeRisk')
    const running = [...host.querySelectorAll('button')].find(button => button.textContent === 'running')
    expect(running).toBeTruthy()
    running?.click()
    await vi.waitFor(() => {
      expect(transitionCalls).toBe(1)
      expect(taskCalls).toBe(2)
      expect(host.querySelector('[data-page-inbox="tasks"]')?.textContent).toContain('running · high')
    })
    const approve = [...host.querySelectorAll('button')].find(button => button.textContent === 'approve')
    expect(approve).toBeTruthy()
    approve?.click()
    await vi.waitFor(() => {
      expect(decisionCalls).toBe(1)
      expect(approvalCalls).toBe(3)
      expect(host.querySelector('[data-page-inbox="approvals"]')?.textContent).toContain('No entitled approvals are waiting in this environment.')
    })
  })

  it('fails closed for a layout ActionButton that the page did not declare', async () => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'ops',
        title: 'Operations',
        pattern: 'Operations Console',
        actions: ['Supplier.changeRisk'],
        layout: {
          component: 'Page',
          children: [{ component: 'ActionButton', props: { action: 'secret.mutate' } }],
        },
      },
      designSystem: { id: 'obis-enterprise', version: '1.0.0' },
      permissions: {
        moduleId: 'supplier-risk',
        moduleVersion: '1.0.0',
        visible: true,
        executable: true,
        configurable: false,
        editable: false,
        administerable: false,
        reasons: ['test'],
      },
      runtime: { actions: [] },
    }
    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge: {
        action: async () => {
          throw new Error('undeclared ActionButton must not execute')
        },
      } as unknown as DesktopApplicationBridge,
    })
    expect(host.textContent).toContain('Action secret.mutate is not declared by this page.')
    expect(host.querySelector('[data-page-action]')).toBeNull()
  })

  it.each([['Supplier.changeRisk'], undefined])('refuses a Form binding outside page actions %j', async (actions) => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'ops',
        title: 'Operations',
        pattern: 'Operations Console',
        ...(actions ? { actions } : {}),
        layout: {
          component: 'Page',
          children: [{ component: 'Form', props: { action: 'secret.mutate' } }],
        },
      },
      designSystem: { id: 'obis-enterprise', version: '1.0.0' },
      permissions: {
        moduleId: 'supplier-risk',
        moduleVersion: '1.0.0',
        visible: true,
        executable: true,
        configurable: false,
        editable: false,
        administerable: false,
        reasons: ['test'],
      },
      runtime: { actions: [] },
    }
    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge: {
        action: async () => {
          throw new Error('undeclared Form must not execute')
        },
      } as unknown as DesktopApplicationBridge,
    })
    expect(host.textContent).toContain('Submit binding secret.mutate is not declared by this page.')
    expect(host.querySelector('[data-page-action]')).toBeNull()
  })

  it('opens the declared action form from layout ActionButton without executing from props.action', async () => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'ops',
        title: 'Operations',
        pattern: 'Operations Console',
        actions: ['Supplier.changeRisk'],
        layout: {
          component: 'Page',
          children: [{ component: 'ActionButton', props: { action: 'Supplier.changeRisk', label: 'Change risk' } }],
        },
      },
      designSystem: { id: 'obis-enterprise', version: '1.0.0' },
      permissions: {
        moduleId: 'supplier-risk',
        moduleVersion: '1.0.0',
        visible: true,
        executable: true,
        configurable: false,
        editable: false,
        administerable: false,
        reasons: ['test'],
      },
      runtime: {
        actions: [{
          name: 'Supplier.changeRisk',
          target: 'Supplier',
          risk: 'medium',
          input: { risk: { type: 'string', required: true } },
        }],
      },
    }
    let actionCalls = 0
    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge: {
        action: async () => {
          actionCalls += 1
          throw new Error('layout ActionButton must not execute from props.action')
        },
      } as unknown as DesktopApplicationBridge,
    })
    const form = host.querySelector<HTMLDetailsElement>('[data-action-form="Supplier.changeRisk"]')
    expect(form).not.toBeNull()
    expect(form?.open).toBe(false)
    host.querySelector<HTMLButtonElement>('[data-page-action="Supplier.changeRisk"] button')?.click()
    expect(form?.open).toBe(true)
    expect(actionCalls).toBe(0)
  })

  it('opens the declared action form from layout Form without executing from props.action', async () => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'ops',
        title: 'Operations',
        pattern: 'Operations Console',
        actions: ['Supplier.changeRisk'],
        layout: { component: 'Page', children: [{ component: 'Form', props: { action: 'Supplier.changeRisk', title: 'Change risk' } }] },
      },
      designSystem: { id: 'obis-enterprise', version: '1.0.0' },
      permissions: {
        moduleId: 'supplier-risk',
        moduleVersion: '1.0.0',
        visible: true,
        executable: true,
        configurable: false,
        editable: false,
        administerable: false,
        reasons: ['test'],
      },
      runtime: {
        actions: [{
          name: 'Supplier.changeRisk',
          target: 'Supplier',
          risk: 'medium',
          input: { risk: { type: 'string', required: true } },
        }],
      },
    }
    let actionCalls = 0
    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge: {
        action: async () => {
          actionCalls += 1
          throw new Error('layout Form must not execute from props.action')
        },
      } as unknown as DesktopApplicationBridge,
    })
    const form = host.querySelector<HTMLDetailsElement>('[data-action-form="Supplier.changeRisk"]')
    expect(form).not.toBeNull()
    expect(form?.open).toBe(false)
    host.querySelector<HTMLButtonElement>('[data-component="Form"] [data-page-action="Supplier.changeRisk"] button')?.click()
    expect(form?.open).toBe(true)
    expect(actionCalls).toBe(0)
  })

  it('executes a declared action through approval refresh without inventing authority from layout props', async () => {
    const host = document.createElement('div')
    const envelope: DesktopApplicationPageEnvelope = {
      module: { id: 'supplier-risk', version: '1.0.0', name: 'Supplier Risk' },
      page: {
        id: 'ops',
        title: 'Operations',
        pattern: 'Operations Console',
        actions: ['Supplier.changeRisk'],
        layout: { component: 'Page', children: [{ component: 'ActionButton', props: { action: 'Supplier.changeRisk', label: 'Change risk' } }] },
      },
      designSystem: { id: 'obis-enterprise', version: '1.0.0' },
      permissions: {
        moduleId: 'supplier-risk',
        moduleVersion: '1.0.0',
        visible: true,
        executable: true,
        configurable: false,
        editable: false,
        administerable: false,
        reasons: ['test'],
      },
      runtime: {
        actions: [{
          name: 'Supplier.changeRisk',
          target: 'Supplier',
          risk: 'medium',
          approval: 'supplier-risk-change',
          input: { risk: { type: 'string', required: true } },
        }],
      },
    }
    let actionCalls = 0
    let approvalCalls = 0
    await renderDesktopApplicationPage(host, envelope, {
      scope: { projectId: 'procurement', environmentId: 'prod' },
      bridge: {
        action: async (input: Parameters<DesktopApplicationBridge['action']>[0]) => {
          actionCalls += 1
          if (actionCalls === 1) {
            expect(input.action).toBe('Supplier.changeRisk')
            expect(input.input).toEqual({ risk: 'high' })
            return {
              requestId: 'act-1',
              idempotencyKey: 'idem-1',
              status: 'approval-required' as const,
              decision: {
                allowed: true,
                matchedPolicies: ['supplier-risk'],
                reason: 'Needs approval',
                requiresApproval: 'supplier-risk-change',
              },
              output: { approvalId: 'appr-1' },
            }
          }
          expect(input.idempotencyKey).toBe('idem-1')
          return {
            requestId: 'act-2',
            idempotencyKey: 'idem-1',
            status: 'executed' as const,
            decision: {
              allowed: true,
              matchedPolicies: ['supplier-risk'],
              reason: 'Executed',
            },
          }
        },
        approval: async (input: Parameters<DesktopApplicationBridge['approval']>[0]) => {
          approvalCalls += 1
          expect(input.approvalId).toBe('appr-1')
          return {
            id: 'appr-1',
            status: 'approved' as const,
            version: 2,
            action: 'Supplier.changeRisk',
            gate: 'supplier-risk-change',
            requesterId: 'user-1',
            updatedAt: '2026-09-30T00:00:00.000Z',
            currentStage: { id: 'manager', name: 'Manager', quorum: 1, approvals: 1, rejections: 0 },
          }
        },
      } as unknown as DesktopApplicationBridge,
    })
    const risk = host.querySelector<HTMLInputElement>('[aria-label="risk"]')
    expect(risk).not.toBeNull()
    if (risk) risk.value = 'high'
    const execute = [...host.querySelectorAll('button')].find(button => button.textContent === 'Execute Supplier.changeRisk')
    execute?.click()
    await vi.waitFor(() => {
      expect(actionCalls).toBe(1)
      expect(host.textContent).toContain('appr-1')
    })
    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent === 'Refresh approval')
    expect(refresh).toBeTruthy()
    refresh?.click()
    await vi.waitFor(() => {
      expect(approvalCalls).toBe(1)
      expect(actionCalls).toBe(2)
      expect(host.textContent).toContain('Action executed through the governed OBIS Action Runtime.')
    })
  })
})
