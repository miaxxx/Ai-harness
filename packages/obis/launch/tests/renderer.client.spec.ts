// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderSharedApplicationLayout, type SharedRendererLayout } from '../src/client/renderer.ts'

function page(children: SharedRendererLayout[], props?: Record<string, unknown>): SharedRendererLayout {
  return { component: 'Page', ...(props ? { props } : {}), children }
}

describe('shared application renderer', () => {
  it('blocks unknown components, patterns, tokens, and invalid props', () => {
    const unknown = renderSharedApplicationLayout({ component: 'Kanban' })
    expect(unknown.dataset.rendererState).toBe('blocked')
    expect(unknown.textContent).toContain('unavailable in the shared renderer contract')

    const pattern = renderSharedApplicationLayout({ component: 'Page' }, { pattern: 'record' })
    expect(pattern.dataset.rendererState).toBe('blocked')
    expect(pattern.textContent).toContain('Pattern record is not registered.')

    const token = renderSharedApplicationLayout({ component: 'Page', tokenRefs: ['not.a.token'] })
    expect(token.dataset.rendererState).toBe('blocked')
    expect(token.textContent).toContain('Token not.a.token is not registered.')

    const invalid = renderSharedApplicationLayout({ component: 'Page', props: { title: 12 } })
    expect(invalid.dataset.rendererState).toBe('blocked')
    expect(invalid.textContent).toContain('does not match string')
  })

  it('renders the registered component set with empty query rows', () => {
    const tree: SharedRendererLayout = page([
      { component: 'Search', props: { label: 'Find', placeholder: 'Find rows', fields: ['name'] } },
      { component: 'Search' },
      { component: 'Filter', props: { field: 'status', label: 'Status' } },
      { component: 'Filter', props: { field: 'owner' } },
      { component: 'Filter' },
      {
        component: 'Form',
        props: {
          fields: [
            { name: 'dept', label: 'Dept', options: ['HR', 'IT'] },
            { name: 'days', type: 'weird' },
            { name: 'when', type: 'date' },
            { name: 'ok', type: 'checkbox', required: true },
            { name: '', required: false },
          ],
          action: 'submit_leave',
        },
      },
      { component: 'Form' },
      { component: 'Table', props: { columns: ['name'], selectable: true } },
      { component: 'DataTable' },
      { component: 'ApprovalQueue', props: { title: 'Queue' } },
      { component: 'Detail', props: { fields: ['name'] } },
      { component: 'ObjectDetail' },
      { component: 'Chart' },
      { component: 'Chart', props: { valueField: 'amount' } },
      { component: 'Chart', props: { title: 'Spend', valueField: 'amount', categoryField: 'name', maxItems: 4 } },
      { component: 'Timeline' },
      { component: 'ActivityFeed' },
      { component: 'RiskIndicator', props: { field: 'severity' } },
      { component: 'RiskIndicator' },
      { component: 'MetricCard' },
      { component: 'MetricCard', props: { aggregation: 'sum' } },
      { component: 'MetricCard', props: { title: 'Open risks', aggregation: 'sum', valueField: 'amount' } },
      { component: 'TaskList' },
      { component: 'TaskList', props: { titleField: 'name', statusField: 'state' } },
      { component: 'FileViewer' },
      { component: 'FileViewer', props: { nameField: 'filename', mimeField: 'type', sizeField: 'bytes' } },
      { component: 'KnowledgeSearch' },
      { component: 'KnowledgeSearch', props: { titleField: 'heading', snippetField: 'excerpt' } },
      { component: 'ActionButton' },
      { component: 'ActionButton', props: { action: 'submit_leave', label: 'Submit leave' } },
      { component: 'WorkflowStatus' },
      { component: 'WorkflowStatus', props: { statusField: 'state' } },
      { component: 'NotificationPanel' },
      { component: 'NotificationPanel', props: { titleField: 'heading', bodyField: 'message' } },
      { component: 'ObjectPicker' },
      { component: 'PeoplePicker', props: { label: 'People', field: 'name' } },
      { component: 'Section', props: { title: 'Section', description: 'Notes' } },
      { component: 'Section' },
      { component: 'Stack', props: { gap: 'md' } },
      { component: 'Grid', props: { columns: 2 } },
      { component: 'Dashboard' },
      {
        component: 'Tabs',
        children: [
          { component: 'Section', props: { title: 'Alpha' } },
          { component: 'Section', props: { label: 'Beta' } },
          { component: 'Section' },
        ],
      },
      { component: 'Tabs' },
      {
        component: 'Drawer',
        props: { openLabel: 'Open drawer', title: 'Drawer title' },
        children: [{ component: 'Stack' }],
      },
      { component: 'Modal', children: [{ component: 'Stack' }] },
      { component: 'AISummary', props: { prompt: 'Summarize leave' } },
      { component: 'AIComposer' },
      { component: 'AIAssistant', props: { prompt: 'Ask about leave' } },
    ], { extra: true })
    tree.tokenRefs = ['color.accent']
    const host = renderSharedApplicationLayout(tree, {
      pattern: 'Object Detail',
      queryName: 'leave_rows',
      actions: ['submit'],
      designSystem: { id: 'ds', version: '1' },
    })
    expect(host.getAttribute('data-renderer-contract')).toBe('obis-ui-runtime@0.1')
    expect(host.textContent).toContain('Shared Renderer')
    expect(host.textContent).toContain('Pattern: Object Detail')
    expect(host.textContent).toContain('Query: leave_rows')
    expect(host.textContent).toContain('Actions: submit')
    expect(host.textContent).toContain('DS: ds@1')
    expect(host.textContent).toContain('1 renderer contract warning(s)')
    expect(host.textContent).toContain('No rows match the current governed query and local view filters.')
    expect(host.textContent).toContain('Select a row to inspect its governed object detail.')
    expect(host.textContent).toContain('Chart requires props.valueField.')
    expect(host.textContent).toContain('No numeric values are available for amount.')
    expect(host.querySelector('[aria-label="Governed data chart"]')).toBeTruthy()
    expect(host.textContent).toContain('No values are available for risk field severity.')
    expect(host.textContent).toContain('MetricCard requires props.valueField for sum and avg.')
    expect(host.textContent).toContain('No numeric values are available for amount.')
    expect(host.textContent).toContain('No tasks match the current governed query and local view filters.')
    expect(host.textContent).toContain('No files match the current governed query and local view filters.')
    expect(host.textContent).toContain('No knowledge citations match the current governed query and local view filters.')
    expect(host.textContent).toContain('ActionButton requires props.action.')
    expect(host.textContent).toContain('Action binding: submit_leave. Execution is supplied by the host adapter.')
    expect(host.textContent).toContain('No workflow states match the current governed query and local view filters.')
    expect(host.textContent).toContain('No notifications match the current governed query and local view filters.')
    expect(host.querySelector('[data-component="MetricCard"]')).toBeTruthy()
    expect(host.querySelector('[data-component="TaskList"]')).toBeTruthy()
    expect(host.querySelector('[data-component="FileViewer"]')).toBeTruthy()
    expect(host.querySelector('[data-component="KnowledgeSearch"]')).toBeTruthy()
    expect(host.querySelector('[data-component="ActionButton"]')).toBeTruthy()
    expect(host.querySelector('[data-component="WorkflowStatus"]')).toBeTruthy()
    expect(host.querySelector('[data-component="NotificationPanel"]')).toBeTruthy()
    expect(host.querySelector('[data-component="AIAssistant"]')).toBeTruthy()
    expect(host.textContent).toContain('props.field is required.')
    expect(host.textContent).toContain('Filter owner')
    expect(host.textContent).toContain('No values are available for risk field risk.')
    expect(host.textContent).toContain('Submit binding: submit_leave')
    expect(host.textContent).toContain('0 governed row(s) are available as host-supplied context.')
    expect(host.querySelector('blockquote')?.textContent).toBe('Summarize leave')
    expect(host.textContent).toContain('Ask about leave')
    expect(host.querySelector('[data-search-fields="name"]')).toBeTruthy()
    expect((host.querySelector('.appSearch input') as HTMLInputElement).placeholder).toBe('Find rows')

    const tabs = [...host.querySelectorAll('[data-component="Tabs"]')][0]!
    const tabButtons = [...tabs.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    expect(tabButtons[0]!.getAttribute('aria-selected')).toBe('true')
    tabButtons[1]!.click()
    expect(tabButtons[1]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs.querySelector('[role="tabpanel"]')?.textContent).toContain('Beta')
    tabButtons[2]!.click()
    expect(tabButtons[2]!.textContent).toBe('Tab 3')

    const drawer = host.querySelector('[data-component="Drawer"]')!
    const drawerToggle = drawer.querySelector('button') as HTMLButtonElement
    expect(drawerToggle.getAttribute('aria-expanded')).toBe('false')
    drawerToggle.click()
    expect(drawerToggle.getAttribute('aria-expanded')).toBe('true')
    expect(drawer.textContent).toContain('Drawer title')
    drawerToggle.click()
    expect(drawerToggle.getAttribute('aria-expanded')).toBe('false')

    const modalToggle = host.querySelector('[data-component="Modal"] button') as HTMLButtonElement
    modalToggle.click()
    expect(modalToggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('omits optional banner fields and still validates remaining prop kinds', () => {
    const host = renderSharedApplicationLayout({ component: 'Page' })
    expect(host.textContent).toContain('No pattern')
    expect(host.textContent).toContain('No page query')
    expect(host.textContent).toContain('No page actions')
    expect(host.querySelector('.appContractWarnings')).toBeNull()

    expect(renderSharedApplicationLayout({
      component: 'Grid',
      props: { columns: 'two' },
    }).textContent).toContain('does not match number')
    expect(renderSharedApplicationLayout({
      component: 'Table',
      props: { selectable: 'yes' },
    }).textContent).toContain('does not match boolean')
    expect(renderSharedApplicationLayout({
      component: 'DataTable',
      props: { columns: [1] },
    }).textContent).toContain('does not match string[]')
    expect(renderSharedApplicationLayout({
      component: 'Form',
      props: { fields: 'nope' },
    }).textContent).toContain('does not match fields')
    expect(renderSharedApplicationLayout({
      component: 'Form',
      props: { fields: [{ label: 'x' }] },
    }).textContent).toContain('does not match fields')
    expect(renderSharedApplicationLayout({
      component: 'Form',
      props: { fields: [{ name: 'dept', options: [1] }] },
    }).textContent).toContain('does not match fields')
  })
})
