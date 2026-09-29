/** DOM adapter for the OBIS shared UI Runtime component registry.
 * Query rows stay empty: this overlay does not execute Query, Action, Approval, or AI.
 * Registry ids and empty-state copy match `25-ui-runtime` renderer-react; Harness cannot depend on that package.
 */

/** Kernel page layout node accepted by the launch overlay shared renderer. */
export interface SharedRendererLayout {
  component: string
  id?: string
  tokenRefs?: string[]
  props?: Record<string, unknown>
  children?: SharedRendererLayout[]
}

/** Page identifiers shown in the shared renderer banner; none of these execute Query or Action. */
export interface SharedRendererView {
  pattern?: string
  queryName?: string
  actions?: readonly string[]
  designSystem?: { id: string; version: string }
}

type PropKind = 'string' | 'number' | 'boolean' | 'string[]' | 'fields'

type RendererIssue = {
  severity: 'error' | 'warning'
  code: string
  path: string
  message: string
}

const PATTERNS = new Set([
  'List', 'Master Detail', 'Dashboard', 'Object Detail', 'Approval Queue',
  'Wizard', 'Search', 'Settings', 'Operations Console', 'Task Workspace', 'Analytics',
])

const TOKENS = new Set([
  'color.accent', 'color.success', 'color.warning', 'color.danger',
  'surface.canvas', 'surface.default', 'surface.raised', 'surface.subtle',
  'text.primary', 'text.secondary', 'text.muted', 'text.inverse',
  'border.default', 'border.strong',
  'radius.sm', 'radius.md', 'radius.lg',
  'space.xs', 'space.sm', 'space.md', 'space.lg', 'space.xl',
  'density.compact', 'density.default', 'density.comfortable',
  'type.body', 'type.label', 'type.title', 'type.metric',
  'motion.fast', 'motion.standard', 'motion.slow',
  'elevation.none', 'elevation.low', 'elevation.medium',
])

const common = { title: 'string', label: 'string', description: 'string' } as const

const COMPONENT_PROPS: Record<string, Record<string, PropKind>> = {
  Page: { ...common },
  Section: { ...common },
  Stack: { ...common, gap: 'string' },
  Grid: { ...common, columns: 'number', gap: 'string' },
  Form: { ...common, fields: 'fields', action: 'string' },
  Table: { ...common, columns: 'string[]', selectable: 'boolean' },
  Tabs: { ...common },
  Drawer: { ...common, openLabel: 'string' },
  Modal: { ...common, openLabel: 'string' },
  Dashboard: { ...common, columns: 'number' },
  Chart: { ...common, categoryField: 'string', valueField: 'string', maxItems: 'number' },
  Detail: { ...common, fields: 'string[]' },
  Search: { ...common, placeholder: 'string', fields: 'string[]' },
  Filter: { ...common, field: 'string' },
  DataTable: { ...common, columns: 'string[]', selectable: 'boolean' },
  ObjectDetail: { ...common, fields: 'string[]' },
  ObjectPicker: { ...common, field: 'string' },
  PeoplePicker: { ...common, field: 'string' },
  ApprovalQueue: { ...common, columns: 'string[]' },
  Timeline: { ...common, timestampField: 'string', titleField: 'string', descriptionField: 'string' },
  ActivityFeed: { ...common, timestampField: 'string', titleField: 'string', descriptionField: 'string' },
  RiskIndicator: { ...common, field: 'string' },
  MetricCard: { ...common, valueField: 'string', aggregation: 'string' },
  TaskList: { ...common, titleField: 'string', statusField: 'string', assigneeField: 'string', dueField: 'string' },
  FileViewer: { ...common, nameField: 'string', mimeField: 'string', sizeField: 'string' },
  KnowledgeSearch: { ...common, titleField: 'string', snippetField: 'string', citationField: 'string' },
  ActionButton: { ...common, action: 'string' },
  WorkflowStatus: { ...common, statusField: 'string' },
  NotificationPanel: { ...common, titleField: 'string', bodyField: 'string', severityField: 'string' },
  AIAssistant: { ...common, prompt: 'string' },
  AISummary: { ...common, prompt: 'string' },
  AIComposer: { ...common, prompt: 'string' },
}

/** CSS concatenated into the launch overlay style tag. */
export const SHARED_RENDERER_STYLE = `
    .applicationRenderer{display:grid;gap:14px}
    .appRuntimeBanner,.appDataHead{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;font-size:12px;color:#68707d}
    .appContractError,.appContractWarnings,.appDataBlock,.appAiBlock,.appSection,.appContainer,.appTabs{border:1px solid rgba(22,24,29,.12);border-radius:12px;background:white;padding:14px;display:grid;gap:10px}
    .appContractError{border-color:#b42318;color:#b42318}
    .appPage,.appStack,.appGrid{display:grid;gap:14px}
    .appGrid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
    .appSearch,.appFilter,.appPicker,.appDeclarativeForm label{display:grid;gap:6px;font-size:13px}
    .appDeclarativeForm{border:0;padding:0;margin:0;display:grid;gap:10px}
    .appFormHint,.appUnsupported{margin:0;color:#68707d;font-size:12px}
    .appTabList{display:flex;flex-wrap:wrap;gap:8px}
    .appDisclosureToggle,.appTabList button{border:1px solid rgba(22,24,29,.12);background:#eef0f3;border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit}
    .appMetricCard{display:grid;gap:4px;padding:16px;border:1px solid rgba(22,24,29,.12);border-radius:12px}
    .appMetricCard strong{font-size:28px;font-variant-numeric:tabular-nums}
    .appMetricCard span{color:#68707d;font-size:12px}
    .appTaskList{display:grid;gap:10px;padding:0;list-style:none}
    .appTaskList li{display:grid;gap:2px;padding:10px 0;border-bottom:1px solid rgba(22,24,29,.08)}
    .appTaskList span,.appTaskList time{color:#68707d;font-size:12px}
    .appFileList,.appKnowledgeList{display:grid;gap:10px;padding:0;list-style:none}
    .appFileList li,.appKnowledgeList li{display:grid;gap:2px;padding:10px 0;border-bottom:1px solid rgba(22,24,29,.08)}
    .appFileList span,.appKnowledgeList p,.appKnowledgeList cite{color:#68707d;font-size:12px}
    .appActionButton{display:grid;gap:8px}
    .appActionButton button{justify-self:start;border:1px solid rgba(22,24,29,.12);border-radius:8px;padding:9px 12px;background:white;font-weight:700}
    .appWorkflowStatus{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px}
    .appNotificationList{display:grid;gap:10px;padding:0;list-style:none}
    .appNotificationList li{display:grid;gap:2px;padding:10px 0;border-bottom:1px solid rgba(22,24,29,.08)}
    .appNotificationList span,.appNotificationList p{color:#68707d;font-size:12px;margin:0}
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function propMatches(kind: PropKind, value: unknown): boolean {
  if (kind === 'string') return typeof value === 'string'
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (kind === 'boolean') return typeof value === 'boolean'
  if (kind === 'string[]') return Array.isArray(value) && value.every(item => typeof item === 'string')
  return Array.isArray(value) && value.every(item =>
    isRecord(item)
    && typeof item.name === 'string'
    && (item.label === undefined || typeof item.label === 'string')
    && (item.type === undefined || typeof item.type === 'string')
    && (item.required === undefined || typeof item.required === 'boolean')
    && (item.options === undefined || (Array.isArray(item.options) && item.options.every(option => typeof option === 'string'))),
  )
}

function validate(root: SharedRendererLayout, view: SharedRendererView): RendererIssue[] {
  const issues: RendererIssue[] = []
  if (view.pattern && !PATTERNS.has(view.pattern)) {
    issues.push({
      severity: 'error',
      code: 'PATTERN_UNKNOWN',
      path: 'pattern',
      message: `Pattern ${view.pattern} is not registered.`,
    })
  }
  function visit(node: SharedRendererLayout, path: string) {
    const definition = COMPONENT_PROPS[node.component]
    if (!definition) {
      issues.push({
        severity: 'error',
        code: 'COMPONENT_UNKNOWN',
        path,
        message: `Component ${node.component} is unavailable in the shared renderer contract.`,
      })
    } else if (node.props) {
      for (const [name, value] of Object.entries(node.props)) {
        const kind = definition[name]
        if (!kind) {
          issues.push({
            severity: 'warning',
            code: 'PROP_UNKNOWN',
            path: `${path}.props.${name}`,
            message: `Prop ${name} is not registered for ${node.component}; it will be ignored by the shared renderer.`,
          })
        } else if (!propMatches(kind, value)) {
          issues.push({
            severity: 'error',
            code: 'PROP_INVALID',
            path: `${path}.props.${name}`,
            message: `Prop ${name} does not match ${kind}.`,
          })
        }
      }
    }
    for (const token of node.tokenRefs ?? []) {
      if (!TOKENS.has(token)) {
        issues.push({
          severity: 'error',
          code: 'TOKEN_UNKNOWN',
          path: `${path}.tokenRefs`,
          message: `Token ${token} is not registered.`,
        })
      }
    }
    for (const [index, child] of (node.children ?? []).entries()) visit(child, `${path}.children[${index}]`)
  }
  visit(root, 'layout')
  return issues
}

function blocked(issues: RendererIssue[]): HTMLElement {
  const host = el('section', 'appContractError')
  host.setAttribute('data-renderer-state', 'blocked')
  const title = el('strong')
  title.textContent = 'Shared renderer blocked an invalid UI contract.'
  const list = document.createElement('ul')
  for (const issue of issues) {
    const item = document.createElement('li')
    item.textContent = `${issue.path}: ${issue.message}`
    list.append(item)
  }
  host.append(title, list)
  return host
}

function heading(node: SharedRendererLayout, fallback: string): string {
  return text(node.props?.title) ?? text(node.props?.label) ?? fallback
}

function appendChildren(host: HTMLElement, node: SharedRendererLayout): void {
  for (const child of node.children ?? []) host.append(renderNode(child))
}

function dataHead(title: string, meta: string): HTMLElement {
  const head = el('div', 'appDataHead')
  const strong = el('strong')
  strong.textContent = title
  const span = el('span')
  span.textContent = meta
  head.append(strong, span)
  return head
}

function form(node: SharedRendererLayout): HTMLElement {
  const fieldset = el('fieldset', 'appDeclarativeForm')
  const legend = document.createElement('legend')
  legend.textContent = heading(node, 'Form')
  fieldset.append(legend)
  const rawFields = node.props?.fields
  const fields = Array.isArray(rawFields) ? rawFields : []
  for (const [index, entry] of fields.entries()) {
    const field = entry as Record<string, unknown>
    const name = text(field.name) ?? `field-${String(index)}`
    const label = document.createElement('label')
    label.append(text(field.label) ?? name)
    const options = stringArray(field.options)
    if (options.length) {
      const select = document.createElement('select')
      select.name = name
      const blank = document.createElement('option')
      blank.value = ''
      blank.textContent = 'Select…'
      select.append(blank)
      for (const option of options) {
        const item = document.createElement('option')
        item.value = option
        item.textContent = option
        select.append(item)
      }
      label.append(select)
    } else {
      const input = document.createElement('input')
      input.name = name
      const type = text(field.type) ?? 'text'
      input.type = ['text', 'number', 'date', 'email', 'checkbox'].includes(type) ? type : 'text'
      if (field.required === true) input.required = true
      label.append(input)
    }
    fieldset.append(label)
  }
  const action = text(node.props?.action)
  if (action) {
    const hint = el('p', 'appFormHint')
    hint.textContent = `Submit binding: ${action}. Execution is supplied by the host adapter.`
    fieldset.append(hint)
  }
  return fieldset
}

function emptyRows(): HTMLElement {
  const note = document.createElement('p')
  note.textContent = 'No rows match the current governed query and local view filters.'
  return note
}

function emptyDetail(): HTMLElement {
  const note = document.createElement('p')
  note.textContent = 'Select a row to inspect its governed object detail.'
  return note
}

function chart(node: SharedRendererLayout): HTMLElement {
  const valueField = text(node.props?.valueField)
  if (!valueField) {
    const note = document.createElement('p')
    note.textContent = 'Chart requires props.valueField.'
    return note
  }
  const host = el('div', 'appChart')
  host.setAttribute('role', 'img')
  host.setAttribute('aria-label', text(node.props?.title) ?? 'Governed data chart')
  const note = document.createElement('p')
  note.textContent = `No numeric values are available for ${valueField}.`
  host.append(note)
  return host
}

function timeline(): HTMLElement {
  return document.createElement('ol')
}

function risk(node: SharedRendererLayout): HTMLElement {
  const field = text(node.props?.field) ?? 'risk'
  const host = el('div', 'appRiskGrid')
  const note = document.createElement('p')
  note.textContent = `No values are available for risk field ${field}.`
  host.append(note)
  return host
}

function metric(node: SharedRendererLayout): HTMLElement {
  const aggregation = text(node.props?.aggregation) ?? 'count'
  const valueField = text(node.props?.valueField)
  if (aggregation !== 'count' && aggregation !== 'sum' && aggregation !== 'avg') {
    const note = document.createElement('p')
    note.textContent = 'MetricCard aggregation must be count, sum or avg.'
    return note
  }
  if (aggregation !== 'count') {
    const note = document.createElement('p')
    note.textContent = valueField
      ? `No numeric values are available for ${valueField}.`
      : 'MetricCard requires props.valueField for sum and avg.'
    return note
  }
  const host = el('div', 'appMetricCard')
  const value = document.createElement('strong')
  value.textContent = '0'
  const label = document.createElement('span')
  label.textContent = text(node.props?.label) ?? text(node.props?.title) ?? 'Metric'
  host.append(value, label)
  return host
}

function taskList(): HTMLElement {
  const note = document.createElement('p')
  note.textContent = 'No tasks match the current governed query and local view filters.'
  return note
}

function fileViewer(): HTMLElement {
  const note = document.createElement('p')
  note.textContent = 'No files match the current governed query and local view filters.'
  return note
}

function knowledgeSearch(): HTMLElement {
  const note = document.createElement('p')
  note.textContent = 'No knowledge citations match the current governed query and local view filters.'
  return note
}

function actionButton(node: SharedRendererLayout): HTMLElement {
  const action = text(node.props?.action)
  if (!action) {
    const note = document.createElement('p')
    note.textContent = 'ActionButton requires props.action.'
    return note
  }
  const host = el('div', 'appActionButton')
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text(node.props?.label) ?? text(node.props?.title) ?? action
  const hint = el('p', 'appFormHint')
  hint.textContent = `Action binding: ${action}. Execution is supplied by the host adapter.`
  host.append(button, hint)
  return host
}

function workflowStatus(): HTMLElement {
  const note = document.createElement('p')
  note.textContent = 'No workflow states match the current governed query and local view filters.'
  return note
}

function notificationPanel(): HTMLElement {
  const note = document.createElement('p')
  note.textContent = 'No notifications match the current governed query and local view filters.'
  return note
}

function picker(node: SharedRendererLayout): HTMLElement {
  const label = document.createElement('label')
  label.className = 'appPicker'
  label.append(text(node.props?.label) ?? node.component)
  const select = document.createElement('select')
  const blank = document.createElement('option')
  blank.value = ''
  blank.textContent = 'Select…'
  select.append(blank)
  label.append(select)
  return label
}

function search(node: SharedRendererLayout): HTMLElement {
  const label = document.createElement('label')
  label.className = 'appSearch'
  label.append(text(node.props?.label) ?? 'Search')
  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = text(node.props?.placeholder) ?? 'Search visible records…'
  input.dataset.searchFields = stringArray(node.props?.fields).join(',')
  label.append(input)
  return label
}

function filter(node: SharedRendererLayout): HTMLElement {
  const field = text(node.props?.field)
  const label = document.createElement('label')
  label.className = 'appFilter'
  label.append(text(node.props?.label) ?? (field ? `Filter ${field}` : 'Filter'))
  if (!field) {
    const note = document.createElement('span')
    note.textContent = 'props.field is required.'
    label.append(note)
    return label
  }
  const select = document.createElement('select')
  const all = document.createElement('option')
  all.value = ''
  all.textContent = 'All'
  select.append(all)
  label.append(select)
  return label
}

function tabs(node: SharedRendererLayout): HTMLElement {
  const host = el('section', 'appTabs')
  host.dataset.component = 'Tabs'
  const list = node.children ?? []
  const tablist = el('div', 'appTabList')
  tablist.setAttribute('role', 'tablist')
  const panel = el('div', 'appTabPanel')
  panel.setAttribute('role', 'tabpanel')
  const buttons: HTMLButtonElement[] = []
  const show = (index: number) => {
    const safe = Math.min(index, Math.max(0, list.length - 1))
    for (const [buttonIndex, button] of buttons.entries()) {
      button.setAttribute('aria-selected', String(buttonIndex === safe))
    }
    panel.replaceChildren()
    const child = list[safe]
    if (child) panel.append(renderNode(child))
  }
  for (const [index, child] of list.entries()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'tab')
    button.textContent = text(child.props?.label) ?? text(child.props?.title) ?? `Tab ${String(index + 1)}`
    button.addEventListener('click', () => { show(index) })
    buttons.push(button)
    tablist.append(button)
  }
  host.append(tablist, panel)
  show(0)
  return host
}

function disclosure(node: SharedRendererLayout): HTMLElement {
  const host = el('section', 'appContainer')
  host.dataset.component = node.component
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'appDisclosureToggle'
  const closed = text(node.props?.openLabel) ?? `Open ${node.component}`
  toggle.textContent = closed
  toggle.setAttribute('aria-expanded', 'false')
  const panel = el('div', `app${node.component}Panel`)
  const title = text(node.props?.title)
  if (title) {
    const headingNode = document.createElement('h3')
    headingNode.textContent = title
    panel.append(headingNode)
  }
  appendChildren(panel, node)
  let open = false
  toggle.addEventListener('click', () => {
    open = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.textContent = open ? `Close ${node.component}` : closed
    if (open) host.append(panel)
    else panel.remove()
  })
  host.append(toggle)
  return host
}

function dataBlock(node: SharedRendererLayout, meta: string, body: HTMLElement): HTMLElement {
  const host = el('section', 'appDataBlock')
  host.dataset.component = node.component
  host.append(dataHead(heading(node, node.component), meta), body)
  appendChildren(host, node)
  return host
}

function renderNode(node: SharedRendererLayout): HTMLElement {
  if (node.component === 'Page') {
    const host = el('div', 'appPage')
    host.dataset.component = 'Page'
    appendChildren(host, node)
    return host
  }
  if (node.component === 'Section') {
    const host = el('section', 'appSection')
    host.dataset.component = 'Section'
    const headingText = text(node.props?.title) ?? text(node.props?.label)
    if (headingText) {
      const h2 = document.createElement('h2')
      h2.textContent = headingText
      host.append(h2)
    }
    const description = text(node.props?.description)
    if (description) {
      const p = document.createElement('p')
      p.textContent = description
      host.append(p)
    }
    appendChildren(host, node)
    return host
  }
  if (node.component === 'Stack') {
    const host = el('div', 'appStack')
    host.dataset.component = 'Stack'
    appendChildren(host, node)
    return host
  }
  if (node.component === 'Grid' || node.component === 'Dashboard') {
    const host = el('div', 'appGrid')
    host.dataset.component = node.component
    appendChildren(host, node)
    return host
  }
  if (node.component === 'Form') {
    const host = el('section', 'appDataBlock')
    host.dataset.component = 'Form'
    host.append(form(node))
    appendChildren(host, node)
    return host
  }
  if (node.component === 'Search') return search(node)
  if (node.component === 'Filter') return filter(node)
  if (node.component === 'Table' || node.component === 'DataTable' || node.component === 'ApprovalQueue') {
    return dataBlock(node, '0 rows', emptyRows())
  }
  if (node.component === 'Detail' || node.component === 'ObjectDetail') {
    return dataBlock(node, 'no selection', emptyDetail())
  }
  if (node.component === 'Chart') {
    const host = el('section', 'appDataBlock')
    host.dataset.component = 'Chart'
    host.append(dataHead(heading(node, 'Chart'), 'local view of governed rows'), chart(node))
    appendChildren(host, node)
    return host
  }
  if (node.component === 'Timeline' || node.component === 'ActivityFeed') {
    const list = timeline()
    list.className = 'appTimeline'
    return dataBlock(node, 'chronological', list)
  }
  if (node.component === 'RiskIndicator') {
    return dataBlock(node, 'distribution', risk(node))
  }
  if (node.component === 'MetricCard') {
    return dataBlock(node, 'KPI', metric(node))
  }
  if (node.component === 'TaskList') {
    return dataBlock(node, 'work items', taskList())
  }
  if (node.component === 'FileViewer') {
    return dataBlock(node, 'metadata only', fileViewer())
  }
  if (node.component === 'KnowledgeSearch') {
    return dataBlock(node, 'local citations', knowledgeSearch())
  }
  if (node.component === 'ActionButton') {
    return dataBlock(node, 'host-bound', actionButton(node))
  }
  if (node.component === 'WorkflowStatus') {
    return dataBlock(node, 'states', workflowStatus())
  }
  if (node.component === 'NotificationPanel') {
    return dataBlock(node, 'inbox', notificationPanel())
  }
  if (node.component === 'ObjectPicker' || node.component === 'PeoplePicker') {
    const host = el('section', 'appDataBlock')
    host.dataset.component = node.component
    host.append(picker(node))
    appendChildren(host, node)
    return host
  }
  if (node.component === 'Tabs') return tabs(node)
  if (node.component === 'Drawer' || node.component === 'Modal') return disclosure(node)
  const host = el('section', 'appAiBlock')
  host.dataset.component = node.component
  host.append(dataHead(heading(node, node.component), 'host-governed AI'))
  const note = document.createElement('p')
  note.textContent = '0 governed row(s) are available as host-supplied context. Model execution is intentionally not implemented in renderer-core.'
  host.append(note)
  const prompt = text(node.props?.prompt)
  if (prompt) {
    const quote = document.createElement('blockquote')
    quote.textContent = prompt
    host.append(quote)
  }
  appendChildren(host, node)
  return host
}

function banner(view: SharedRendererView, warnings: RendererIssue[]): HTMLElement {
  const host = el('div', 'applicationRenderer')
  host.setAttribute('data-renderer-contract', 'obis-ui-runtime@0.1')
  const bar = el('div', 'appRuntimeBanner')
  const items = [
    'Shared Renderer',
    view.pattern ? `Pattern: ${view.pattern}` : 'No pattern',
    view.queryName ? `Query: ${view.queryName}` : 'No page query',
    '0/0 visible row(s)',
    view.actions?.length ? `Actions: ${view.actions.join(', ')}` : 'No page actions',
    view.designSystem ? `DS: ${view.designSystem.id}@${view.designSystem.version}` : undefined,
  ]
  for (const item of items) {
    if (!item) continue
    const span = el('span')
    span.textContent = item
    bar.append(span)
  }
  host.append(bar)
  if (warnings.length) {
    const details = document.createElement('details')
    details.className = 'appContractWarnings'
    const summary = document.createElement('summary')
    summary.textContent = `${String(warnings.length)} renderer contract warning(s)`
    const list = document.createElement('ul')
    for (const issue of warnings) {
      const item = document.createElement('li')
      item.textContent = `${issue.path}: ${issue.message}`
      list.append(item)
    }
    details.append(summary, list)
    host.append(details)
  }
  return host
}

/**
 * Render a Kernel page layout with the OBIS shared UI Runtime component registry.
 * Data rows are always empty; this overlay does not execute Query or Action.
 * @param layout Kernel page layout tree
 * @param view optional page pattern, query name, actions, and design-system identifiers for the banner
 * @returns a DOM subtree tagged `data-renderer-contract="obis-ui-runtime@0.1"`, or a blocked error section
 */
export function renderSharedApplicationLayout(layout: SharedRendererLayout, view: SharedRendererView = {}): HTMLElement {
  const issues = validate(layout, view)
  const fatal = issues.filter(issue => issue.severity === 'error')
  if (fatal.length) return blocked(fatal)
  const host = banner(view, issues.filter(issue => issue.severity === 'warning'))
  host.append(renderNode(layout))
  return host
}
