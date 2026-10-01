import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import {
  DESKTOP_APPLICATION_COMPONENTS,
  OBIS_UI_RUNTIME_CONTRACT_ID,
  validateDesktopApplicationContract,
  type DesktopApplicationContractIssue,
} from './desktop-application-contract.ts'
import type { DesktopNavigationItem } from './desktop-obis-identity-shared.ts'
import type {
  DesktopApplicationActionBinding,
  DesktopApplicationActionField,
  DesktopApplicationActionResult,
  DesktopApplicationBridge,
  DesktopApplicationInboxApproval,
  DesktopApplicationKnowledgeHit,
  DesktopApplicationNavigationRecord,
  DesktopApplicationPageEnvelope,
  DesktopApplicationPreviewPageEnvelope,
  DesktopApplicationQueryItem,
  DesktopApplicationQueryResult,
  DesktopApplicationTask,
  DesktopApplicationUiNode,
  DesktopModuleNavigationItem,
} from './desktop-application-shared.ts'

const STRUCTURAL_COMPONENTS = new Set([
  'Page', 'Section', 'Stack', 'Grid', 'Form', 'Table', 'Tabs', 'Drawer', 'Modal', 'Dashboard',
])
const SUPPORTED_COMPONENTS = new Set<string>(DESKTOP_APPLICATION_COMPONENTS)

export interface DesktopApplicationRenderRuntime {
  scope: DesktopEnterpriseScopeRequest
  bridge: DesktopApplicationBridge
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function text(node: HTMLElement, value: string): HTMLElement {
  node.textContent = value
  return node
}

function readableComponent(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function scalarProp(node: DesktopApplicationUiNode, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = node.props?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  return undefined
}

function componentClass(component: string): string {
  return `enterprise-app-component enterprise-app-${component.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`
}

function displayValue(value: unknown): string {
  if (value === null) return '—'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable value]'
  }
}

export function applicationQueryColumns(result: DesktopApplicationQueryResult, maxColumns = 8): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const item of result.items.slice(0, 25)) {
    for (const key of Object.keys(item.values)) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
      if (keys.length >= maxColumns) return ['id', ...keys]
    }
  }
  return ['id', ...keys]
}

function renderContractIssues(issues: readonly DesktopApplicationContractIssue[]): HTMLElement {
  const block = el('section', 'enterprise-app-unsupported')
  block.dataset.rendererContract = 'blocked'
  block.append(
    text(el('span', 'enterprise-page-eyebrow'), 'RENDERER CONTRACT BLOCKED'),
    text(el('strong'), 'This application schema is not compatible with the certified Desktop renderer contract.'),
  )
  const list = el('ul')
  for (const issue of issues) {
    list.append(text(el('li'), `${issue.path} · ${issue.message}`))
  }
  block.append(list)
  return block
}

function renderUnsupported(node: DesktopApplicationUiNode): HTMLElement {
  const block = el('section', 'enterprise-app-unsupported')
  block.dataset.component = node.component
  block.append(
    text(el('span', 'enterprise-page-eyebrow'), 'UNSUPPORTED COMPONENT'),
    text(el('strong'), node.component),
    text(el('p'), 'The Desktop runtime refused to execute a component that is not part of its governed renderer allowlist.'),
  )
  return block
}

function renderDataTable(result: DesktopApplicationQueryResult): HTMLElement {
  const wrap = el('div', 'enterprise-app-data-table-wrap')
  if (result.items.length === 0) {
    wrap.append(text(el('p', 'enterprise-app-empty-data'), 'No records matched this governed query.'))
    return wrap
  }

  const columns = applicationQueryColumns(result)
  const table = el('table', 'enterprise-app-data-table')
  const head = el('thead')
  const headRow = el('tr')
  for (const column of columns) headRow.append(text(el('th'), column))
  head.append(headRow)
  table.append(head)

  const body = el('tbody')
  for (const item of result.items.slice(0, 100)) {
    const row = el('tr')
    for (const column of columns) {
      const value = column === 'id' ? item.id : item.values[column]
      row.append(text(el('td'), displayValue(value)))
    }
    body.append(row)
  }
  table.append(body)
  wrap.append(table)
  if (result.truncated || result.items.length > 100) {
    wrap.append(text(el('p', 'enterprise-app-binding'), 'The governed query returned additional records. This view is intentionally bounded.'))
  }
  return wrap
}

function renderObjectDetail(item: DesktopApplicationQueryItem | undefined): HTMLElement {
  const detail = el('dl', 'enterprise-app-object-detail-grid')
  if (!item) {
    detail.append(text(el('p', 'enterprise-app-empty-data'), 'No object is available for this detail view.'))
    return detail
  }
  const values: Array<[string, unknown]> = [['id', item.id], ['object', item.object], ['version', item.version], ...Object.entries(item.values)]
  for (const [key, value] of values.slice(0, 20)) {
    detail.append(text(el('dt'), key), text(el('dd'), displayValue(value)))
  }
  return detail
}

function numericSeries(result: DesktopApplicationQueryResult): Array<{ key: string; value: number }> {
  const totals = new Map<string, number>()
  const counts = new Map<string, number>()
  for (const item of result.items) {
    for (const [key, value] of Object.entries(item.values)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      totals.set(key, (totals.get(key) ?? 0) + value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...totals.entries()]
    .map(([key, total]) => ({ key, value: total / (counts.get(key) ?? 1) }))
    .slice(0, 6)
}

function renderChart(result: DesktopApplicationQueryResult): HTMLElement {
  const series = numericSeries(result)
  const chart = el('div', 'enterprise-app-chart-data')
  if (series.length === 0) {
    chart.append(text(el('p', 'enterprise-app-empty-data'), 'The governed result has no numeric fields to visualize.'))
    return chart
  }
  const maximum = Math.max(...series.map(item => Math.abs(item.value)), 1)
  for (const item of series) {
    const row = el('div', 'enterprise-app-chart-row')
    const meta = el('div', 'enterprise-app-chart-meta')
    meta.append(text(el('span'), item.key), text(el('strong'), displayValue(Math.round(item.value * 100) / 100)))
    const track = el('div', 'enterprise-app-chart-track')
    const bar = el('span', 'enterprise-app-chart-bar')
    bar.style.width = `${Math.max(2, Math.round((Math.abs(item.value) / maximum) * 100))}%`
    track.append(bar)
    row.append(meta, track)
    chart.append(row)
  }
  return chart
}

function renderActivity(result: DesktopApplicationQueryResult): HTMLElement {
  const list = el('div', 'enterprise-app-activity-list')
  for (const item of result.items.slice(0, 8)) {
    const row = el('article', 'enterprise-app-activity-row')
    const headline = Object.values(item.values).find(value => typeof value === 'string')
    row.append(
      text(el('strong'), typeof headline === 'string' ? headline : item.id),
      text(el('span'), `${item.object} · v${item.version}`),
    )
    list.append(row)
  }
  if (!list.childElementCount) list.append(text(el('p', 'enterprise-app-empty-data'), 'No activity records are available.'))
  return list
}

function localViewRoot(node: HTMLElement): HTMLElement | null {
  return node.closest<HTMLElement>('.enterprise-application-page')
}

function applyLocalTableView(root: HTMLElement): void {
  const search = (root.dataset.localSearch ?? '').trim().toLocaleLowerCase()
  const filterField = root.dataset.localFilterField ?? ''
  const filterValue = root.dataset.localFilterValue ?? ''
  for (const table of root.querySelectorAll<HTMLTableElement>('table.enterprise-app-data-table')) {
    const headers = [...table.querySelectorAll('thead th')].map(item => item.textContent || '')
    const filterIndex = filterField ? headers.indexOf(filterField) : -1
    for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      const cells = [...row.cells]
      const matchesSearch = !search || cells.some(cell => (cell.textContent || '').toLocaleLowerCase().includes(search))
      const filterCell = filterIndex >= 0 ? cells[filterIndex] : undefined
      const matchesFilter = !filterValue || filterIndex < 0 || (filterCell ? filterCell.textContent || '' : '') === filterValue
      row.hidden = !(matchesSearch && matchesFilter)
    }
  }
}

function renderSearch(node: DesktopApplicationUiNode): HTMLElement {
  const wrap = el('label', 'enterprise-app-local-search')
  const input = el('input', 'enterprise-app-action-field')
  input.type = 'search'
  input.placeholder = scalarProp(node, 'placeholder') ?? 'Search visible governed rows…'
  wrap.append(text(el('span'), scalarProp(node, 'label', 'title') ?? 'Search'), input)
  input.addEventListener('input', () => {
    const root = localViewRoot(input)
    if (!root) return
    root.dataset.localSearch = input.value
    applyLocalTableView(root)
  })
  return wrap
}

function renderFilter(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const wrap = el('label', 'enterprise-app-local-filter')
  const field = scalarProp(node, 'field')
  wrap.append(text(el('span'), scalarProp(node, 'label', 'title') ?? (field ? `Filter ${field}` : 'Filter')))
  if (!field) {
    wrap.append(text(el('small'), 'props.field is required.'))
    return wrap
  }
  const select = el('select', 'enterprise-app-action-field')
  select.append(new Option('All', ''))
  const values = new Set<string>()
  for (const item of result ? result.items : []) {
    const value = displayValue(item.values[field])
    if (value) values.add(value)
  }
  for (const value of [...values].sort()) select.append(new Option(value, value))
  select.addEventListener('change', () => {
    const root = localViewRoot(select)
    if (!root) return
    root.dataset.localFilterField = field
    root.dataset.localFilterValue = select.value
    applyLocalTableView(root)
  })
  wrap.append(select)
  return wrap
}

function renderPicker(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const wrap = el('label', 'enterprise-app-picker')
  const field = scalarProp(node, 'field') ?? 'name'
  const select = el('select', 'enterprise-app-action-field')
  select.append(new Option('Select…', ''))
  for (const item of result ? result.items : []) {
    select.append(new Option(displayValue(item.values[field] ?? item.id), item.id))
  }
  wrap.append(text(el('span'), scalarProp(node, 'label', 'title') ?? readableComponent(node.component)), select)
  return wrap
}

function renderDeclarativeForm(node: DesktopApplicationUiNode, page: DesktopApplicationPageEnvelope): HTMLElement {
  const action = scalarProp(node, 'action')
  if (action) {
    const declared = page.page.actions ?? []
    if (!declared.includes(action)) {
      return text(el('p', 'enterprise-app-empty-data'), `Submit binding ${action} is not declared by this page.`)
    }
    const binding = page.runtime?.actions.find(item => item.name === action)
    if (binding) {
      const wrap = el('div', 'enterprise-app-layout-action')
      wrap.dataset.pageAction = action
      const button = text(
        el('button', 'enterprise-secondary-button'),
        scalarProp(node, 'label', 'title') ?? `Open ${action}`,
      ) as HTMLButtonElement
      button.type = 'button'
      button.disabled = !page.permissions.executable
      wrap.append(
        button,
        text(el('p', 'enterprise-app-binding'), `Submit binding: ${action}. Execution uses the declared page action form.`),
      )
      return wrap
    }
  }
  const rawFields = node.props ? node.props.fields : undefined
  const fields = Array.isArray(rawFields) ? rawFields : []
  const grid = el('div', 'enterprise-app-action-schema-grid')
  for (const [index, raw] of fields.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const field = raw as Record<string, unknown>
    const name = typeof field.name === 'string' && field.name.trim() ? field.name.trim() : `field-${index}`
    const label = el('label', 'enterprise-app-action-schema-field')
    label.append(text(el('span'), typeof field.label === 'string' && field.label.trim() ? field.label : name))
    const options = Array.isArray(field.options) ? field.options.filter((item): item is string => typeof item === 'string') : []
    if (options.length) {
      const select = el('select', 'enterprise-app-action-field')
      select.name = name
      select.append(new Option('Select…', ''))
      for (const option of options) select.append(new Option(option, option))
      label.append(select)
    } else {
      const input = el('input', 'enterprise-app-action-field')
      input.name = name
      const type = typeof field.type === 'string' ? field.type : 'text'
      input.type = ['number','date','email','checkbox'].includes(type) ? type : 'text'
      input.required = field.required === true
      label.append(input)
    }
    grid.append(label)
  }
  if (action) {
    grid.append(text(el('p', 'enterprise-app-binding'), `Submit binding: ${action}. Execution is supplied by the host adapter.`))
  }
  if (!grid.childElementCount) grid.append(text(el('p', 'enterprise-app-binding'), 'This declarative form has no registered fields.'))
  return grid
}

function renderRiskDistribution(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const field = scalarProp(node, 'field') ?? 'risk'
  const grid = el('div', 'enterprise-app-risk-distribution')
  const counts = new Map<string, number>()
  for (const item of result ? result.items : []) {
    const value = displayValue(item.values[field] ?? item.values.riskLevel ?? item.values.status)
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  for (const [value, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const metric = el('div', 'enterprise-app-risk-metric')
    metric.append(text(el('strong'), String(count)), text(el('span'), value))
    grid.append(metric)
  }
  if (!grid.childElementCount) grid.append(text(el('p', 'enterprise-app-empty-data'), `No values are available for risk field ${field}.`))
  return grid
}

function queryItems(result: DesktopApplicationQueryResult | undefined): DesktopApplicationQueryItem[] {
  return result?.items ?? []
}

function numericValues(items: readonly DesktopApplicationQueryItem[], field: string): number[] {
  return items
    .map((item) => {
      const raw = item.values[field]
      return typeof raw === 'number' ? raw : Number(raw)
    })
    .filter(item => Number.isFinite(item))
}

function renderMetricCard(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const aggregation = scalarProp(node, 'aggregation') ?? 'count'
  const valueField = scalarProp(node, 'valueField')
  const label = scalarProp(node, 'label', 'title') ?? 'Metric'
  if (aggregation !== 'count' && aggregation !== 'sum' && aggregation !== 'avg') {
    return text(el('p', 'enterprise-app-empty-data'), 'MetricCard aggregation must be count, sum or avg.')
  }
  const items = queryItems(result)
  if (aggregation === 'count') {
    const card = el('div', 'enterprise-app-metric-card')
    card.append(text(el('strong'), String(items.length)), text(el('span'), label))
    return card
  }
  if (!valueField) return text(el('p', 'enterprise-app-empty-data'), 'MetricCard requires props.valueField for sum and avg.')
  const values = numericValues(items, valueField)
  if (!values.length) return text(el('p', 'enterprise-app-empty-data'), `No numeric values are available for ${valueField}.`)
  const total = values.reduce((sum, item) => sum + item, 0)
  const displayed = aggregation === 'avg' ? total / values.length : total
  const card = el('div', 'enterprise-app-metric-card')
  card.append(text(el('strong'), String(displayed)), text(el('span'), label))
  return card
}

function renderTaskList(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const items = queryItems(result)
  if (!items.length) return text(el('p', 'enterprise-app-empty-data'), 'No tasks match the current governed query and local view filters.')
  const titleField = scalarProp(node, 'titleField') ?? 'title'
  const statusField = scalarProp(node, 'statusField') ?? 'status'
  const assigneeField = scalarProp(node, 'assigneeField')
  const dueField = scalarProp(node, 'dueField')
  const list = el('ol', 'enterprise-app-item-list')
  const ordered = [...items].sort((a, b) => {
    if (dueField) return displayValue(a.values[dueField] ?? '').localeCompare(displayValue(b.values[dueField] ?? ''))
    return displayValue(a.values[titleField] ?? a.id).localeCompare(displayValue(b.values[titleField] ?? b.id))
  }).slice(0, 50)
  for (const item of ordered) {
    const row = el('li')
    row.append(text(el('strong'), displayValue(item.values[titleField] ?? item.id)))
    row.append(text(el('span'), displayValue(item.values[statusField])))
    if (assigneeField) row.append(text(el('span'), displayValue(item.values[assigneeField])))
    if (dueField) row.append(text(el('time'), displayValue(item.values[dueField])))
    list.append(row)
  }
  return list
}

function layoutHasComponent(node: DesktopApplicationUiNode, component: string): boolean {
  if (node.component === component) return true
  return (node.children ?? []).some(child => layoutHasComponent(child, component))
}

function taskTransitions(status: string): Array<'running' | 'waiting' | 'completed' | 'cancelled'> {
  if (status === 'completed' || status === 'cancelled') return []
  if (status === 'running') return ['waiting', 'completed', 'cancelled']
  return ['running', 'cancelled']
}

interface PageInboxState {
  tasks: DesktopApplicationTask[]
  approvals: DesktopApplicationInboxApproval[]
  tasksError?: string
  approvalsError?: string
}

interface PageCatalogState {
  items: DesktopApplicationKnowledgeHit[]
  error?: string
}

function collectLayoutNodes(node: DesktopApplicationUiNode, component: string): DesktopApplicationUiNode[] {
  const found: DesktopApplicationUiNode[] = []
  const walk = (current: DesktopApplicationUiNode) => {
    if (current.component === component) found.push(current)
    for (const child of current.children ?? []) walk(child)
  }
  walk(node)
  return found
}

function renderTaskInbox(
  inbox: PageInboxState,
  envelope: DesktopApplicationPageEnvelope,
  runtime: DesktopApplicationRenderRuntime,
  reload: () => Promise<void>,
): HTMLElement {
  const mount = el('div')
  mount.dataset.pageInbox = 'tasks'
  if (inbox.tasksError) {
    mount.append(text(el('p', 'enterprise-app-runtime-error'), inbox.tasksError))
    return mount
  }
  if (!inbox.tasks.length) {
    mount.append(text(el('p', 'enterprise-app-binding'), 'No entitled tasks are waiting in this environment.'))
    return mount
  }
  const list = el('ul', 'enterprise-app-item-list')
  for (const task of inbox.tasks) {
    const row = el('li')
    row.append(text(el('strong'), task.title))
    row.append(text(el('span'), `${task.status} · ${task.priority}`))
    if (task.assignee) row.append(text(el('span'), `${task.assignee.type}:${task.assignee.id}`))
    if (task.dueAt) row.append(text(el('time'), task.dueAt))
    if (task.description) row.append(text(el('p'), task.description))
    if (envelope.permissions.executable) {
      const actions = el('div', 'enterprise-app-inbox-actions')
      for (const status of taskTransitions(task.status)) {
        const button = text(el('button', 'enterprise-secondary-button'), status) as HTMLButtonElement
        button.type = 'button'
        button.onclick = () => {
          void (async () => {
            button.disabled = true
            try {
              await runtime.bridge.transitionTask({
                ...runtime.scope,
                taskId: task.id,
                expectedVersion: task.version,
                status,
              })
              await reload()
            } catch (error) {
              row.append(text(el('p', 'enterprise-app-runtime-error'), error instanceof Error ? error.message : 'The task transition failed.'))
              button.disabled = false
            }
          })()
        }
        actions.append(button)
      }
      row.append(actions)
    } else {
      row.append(text(el('p', 'enterprise-app-binding'), 'Task transitions require executable entitlement.'))
    }
    list.append(row)
  }
  mount.append(list)
  return mount
}

function renderApprovalInbox(
  inbox: PageInboxState,
  envelope: DesktopApplicationPageEnvelope,
  runtime: DesktopApplicationRenderRuntime,
  reload: () => Promise<void>,
): HTMLElement {
  const mount = el('div')
  mount.dataset.pageInbox = 'approvals'
  if (inbox.approvalsError) {
    mount.append(text(el('p', 'enterprise-app-runtime-error'), inbox.approvalsError))
    return mount
  }
  if (!inbox.approvals.length) {
    mount.append(text(el('p', 'enterprise-app-binding'), 'No entitled approvals are waiting in this environment.'))
    return mount
  }
  const list = el('ul', 'enterprise-app-item-list')
  for (const item of inbox.approvals) {
    const row = el('li')
    row.append(text(el('strong'), item.action))
    row.append(text(el('span'), `${item.gate} · ${item.status}`))
    row.append(text(
      el('p'),
      `${item.requestId} · stage ${item.currentStage.name ?? item.currentStage.id} · ${String(item.currentStage.approvals)}/${String(item.currentStage.quorum)}`,
    ))
    if (envelope.permissions.executable) {
      const actions = el('div', 'enterprise-app-inbox-actions')
      for (const decision of ['approve', 'reject'] as const) {
        const button = text(el('button', 'enterprise-secondary-button'), decision) as HTMLButtonElement
        button.type = 'button'
        button.onclick = () => {
          void (async () => {
            button.disabled = true
            try {
              await runtime.bridge.decideApproval({
                ...runtime.scope,
                approvalId: item.id,
                expectedVersion: item.version,
                decision,
              })
              await reload()
            } catch (error) {
              row.append(text(el('p', 'enterprise-app-runtime-error'), error instanceof Error ? error.message : 'The approval decision failed.'))
              button.disabled = false
            }
          })()
        }
        actions.append(button)
      }
      row.append(actions)
    } else {
      row.append(text(el('p', 'enterprise-app-binding'), 'Approval decisions require executable entitlement.'))
    }
    list.append(row)
  }
  mount.append(list)
  return mount
}

function renderKnowledgeHits(items: DesktopApplicationKnowledgeHit[]): HTMLElement {
  const list = el('ol', 'enterprise-app-item-list')
  for (const item of items.slice(0, 30)) {
    const row = el('li')
    row.append(text(el('strong'), item.title), text(el('p'), item.content))
    if (item.citation) row.append(text(el('cite'), item.citation))
    list.append(row)
  }
  return list
}

function hydrateEntitledCatalog(
  canvas: HTMLElement,
  envelope: DesktopApplicationPageEnvelope,
  queryResult: DesktopApplicationQueryResult | undefined,
  queryError: string | undefined,
  catalog: PageCatalogState | undefined,
): void {
  const fileNodes = collectLayoutNodes(envelope.page.layout, 'FileViewer')
  for (const [index, block] of [...canvas.querySelectorAll('[data-component="FileViewer"]')].entries()) {
    const mount = block.querySelector('[data-page-files]')
    if (!(mount instanceof HTMLElement)) continue
    mount.replaceChildren()
    if (queryError) {
      mount.append(text(el('p', 'enterprise-app-runtime-error'), queryError))
      continue
    }
    mount.append(renderFileViewer(fileNodes[index] ?? { component: 'FileViewer' }, queryResult))
  }
  if (!catalog) return
  for (const block of canvas.querySelectorAll('[data-component="KnowledgeSearch"]')) {
    const mount = block.querySelector('[data-page-knowledge]')
    if (!(mount instanceof HTMLElement)) continue
    mount.replaceChildren()
    if (catalog.error) {
      mount.append(text(el('p', 'enterprise-app-runtime-error'), catalog.error))
      continue
    }
    if (!catalog.items.length) {
      mount.append(text(el('p', 'enterprise-app-binding'), 'No entitled knowledge citations match this page.'))
      continue
    }
    mount.append(renderKnowledgeHits(catalog.items))
  }
}

function hydrateEntitledInbox(
  canvas: HTMLElement,
  inbox: PageInboxState | undefined,
  envelope: DesktopApplicationPageEnvelope,
  runtime: DesktopApplicationRenderRuntime,
  reload: () => Promise<void>,
): void {
  if (!inbox) return
  for (const block of canvas.querySelectorAll('[data-component="TaskList"]')) {
    block.querySelector('[data-page-inbox="tasks"]')?.remove()
    block.append(renderTaskInbox(inbox, envelope, runtime, reload))
  }
  for (const block of canvas.querySelectorAll('[data-component="ApprovalQueue"]')) {
    block.querySelector('[data-page-inbox="approvals"]')?.remove()
    const hint = [...block.querySelectorAll('p')].find(node => node.textContent === 'Approvals wait for the entitled inbox adapter.')
    hint?.remove()
    block.append(renderApprovalInbox(inbox, envelope, runtime, reload))
  }
}

function renderFileViewer(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const items = queryItems(result)
  if (!items.length) return text(el('p', 'enterprise-app-empty-data'), 'No files match the current governed query and local view filters.')
  const nameField = scalarProp(node, 'nameField') ?? 'name'
  const mimeField = scalarProp(node, 'mimeField') ?? 'mimeType'
  const sizeField = scalarProp(node, 'sizeField') ?? 'size'
  const list = el('ul', 'enterprise-app-item-list')
  for (const item of items.slice(0, 50)) {
    const row = el('li')
    row.append(
      text(el('strong'), displayValue(item.values[nameField] ?? item.id)),
      text(el('span'), displayValue(item.values[mimeField])),
      text(el('span'), displayValue(item.values[sizeField])),
    )
    list.append(row)
  }
  return list
}

function renderKnowledgeSearch(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const items = queryItems(result)
  if (!items.length) return text(el('p', 'enterprise-app-empty-data'), 'No knowledge citations match the current governed query and local view filters.')
  const titleField = scalarProp(node, 'titleField') ?? 'title'
  const snippetField = scalarProp(node, 'snippetField') ?? 'snippet'
  const citationField = scalarProp(node, 'citationField') ?? 'citation'
  const list = el('ol', 'enterprise-app-item-list')
  for (const item of items.slice(0, 30)) {
    const row = el('li')
    row.append(
      text(el('strong'), displayValue(item.values[titleField] ?? item.id)),
      text(el('p'), displayValue(item.values[snippetField])),
      text(el('cite'), displayValue(item.values[citationField])),
    )
    list.append(row)
  }
  return list
}

function bindLayoutActionButtons(root: HTMLElement): void {
  for (const mount of root.querySelectorAll<HTMLElement>('[data-page-action]')) {
    const action = mount.dataset.pageAction
    if (!action) continue
    const button = mount.querySelector('button')
    if (!(button instanceof HTMLButtonElement) || button.disabled) continue
    button.onclick = () => {
      const escaped = action.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
      const form = root.querySelector<HTMLDetailsElement>(`[data-action-form="${escaped}"]`)
      if (!form) return
      form.open = true
      form.scrollIntoView({ block: 'nearest' })
      form.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    }
  }
}

function renderActionButton(node: DesktopApplicationUiNode, page: DesktopApplicationPageEnvelope): HTMLElement {
  const action = scalarProp(node, 'action')
  const label = scalarProp(node, 'label', 'title') ?? action ?? 'Action'
  if (!action) return text(el('p', 'enterprise-app-empty-data'), 'ActionButton requires props.action.')
  const declared = page.page.actions ?? []
  if (!declared.includes(action)) {
    return text(el('p', 'enterprise-app-empty-data'), `Action ${action} is not declared by this page.`)
  }
  const wrap = el('div', 'enterprise-app-layout-action')
  wrap.dataset.pageAction = action
  const binding = page.runtime?.actions.find(item => item.name === action)
  if (!binding) {
    wrap.append(
      text(el('p', 'enterprise-app-binding'), `Action binding: ${action}. The active deployment did not provide a governed input schema for this page action.`),
    )
    return wrap
  }
  const button = text(el('button', 'enterprise-secondary-button'), label) as HTMLButtonElement
  button.type = 'button'
  button.disabled = !page.permissions.executable
  wrap.append(
    button,
    text(el('p', 'enterprise-app-binding'), `Action binding: ${action}. Execution uses the declared page action form.`),
  )
  return wrap
}

function renderWorkflowStatus(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const statusField = scalarProp(node, 'statusField') ?? 'status'
  const counts = new Map<string, number>()
  for (const item of queryItems(result)) {
    const value = displayValue(item.values[statusField])
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  if (!counts.size) return text(el('p', 'enterprise-app-empty-data'), 'No workflow states match the current governed query and local view filters.')
  const grid = el('div', 'enterprise-app-workflow-status')
  for (const [label, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const metric = el('div', 'enterprise-app-risk-metric')
    metric.append(text(el('strong'), String(count)), text(el('span'), label))
    grid.append(metric)
  }
  return grid
}

function renderNotificationPanel(node: DesktopApplicationUiNode, result: DesktopApplicationQueryResult | undefined): HTMLElement {
  const items = queryItems(result)
  if (!items.length) return text(el('p', 'enterprise-app-empty-data'), 'No notifications match the current governed query and local view filters.')
  const titleField = scalarProp(node, 'titleField') ?? 'title'
  const bodyField = scalarProp(node, 'bodyField') ?? 'body'
  const severityField = scalarProp(node, 'severityField') ?? 'severity'
  const list = el('ul', 'enterprise-app-item-list')
  for (const item of items.slice(0, 30)) {
    const row = el('li')
    row.append(
      text(el('strong'), displayValue(item.values[titleField] ?? item.id)),
      text(el('span'), displayValue(item.values[severityField])),
      text(el('p'), displayValue(item.values[bodyField])),
    )
    list.append(row)
  }
  return list
}

function waitingForQuery(
  page: DesktopApplicationPageEnvelope,
  queryError: string | undefined,
  waiting: string,
): HTMLElement {
  return text(
    el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'),
    queryError ?? (page.page.source?.query ? waiting : 'No governed query binding declared for this view.'),
  )
}

function stampRendererContract(canvas: HTMLElement): void {
  canvas.setAttribute('data-renderer-contract', OBIS_UI_RUNTIME_CONTRACT_ID)
}

function renderLeaf(
  node: DesktopApplicationUiNode,
  page: DesktopApplicationPageEnvelope,
  queryResult: DesktopApplicationQueryResult | undefined,
  queryError: string | undefined,
  hostBound: boolean,
): HTMLElement {
  const block = el('section', componentClass(node.component))
  block.dataset.component = node.component
  if (node.id) block.dataset.componentId = node.id

  const label = scalarProp(node, 'title', 'label', 'name') ?? readableComponent(node.component)
  const description = scalarProp(node, 'description', 'helperText', 'emptyText')
  const value = scalarProp(node, 'value', 'metric', 'status')
  block.append(text(el('span', 'enterprise-page-eyebrow'), node.component.toUpperCase()))
  block.append(text(el('h3', 'enterprise-app-component-title'), label))
  if (value) block.append(text(el('strong', 'enterprise-app-component-value'), value))
  if (description) block.append(text(el('p', 'enterprise-app-component-copy'), description))

  if (node.component === 'DataTable' || node.component === 'Table') {
    if (queryResult) block.append(renderDataTable(queryResult))
    else block.append(text(el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'), queryError ?? (page.page.source?.query ? `Governed query · ${page.page.source.query}` : 'No governed query binding declared for this table.')))
  } else if (node.component === 'ApprovalQueue') {
    block.append(text(el('p', 'enterprise-app-binding'), 'Approvals wait for the entitled inbox adapter.'))
  } else if (node.component === 'ObjectDetail' || node.component === 'Detail') {
    if (queryResult) block.append(renderObjectDetail(queryResult.items[0]))
    else block.append(text(el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'), queryError ?? 'Object detail waits for a governed page query.'))
  } else if (node.component === 'Chart') {
    if (queryResult) block.append(renderChart(queryResult))
    else block.append(text(el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'), queryError ?? 'Chart waits for a governed page query.'))
  } else if (node.component === 'Timeline' || node.component === 'ActivityFeed') {
    if (queryResult) block.append(renderActivity(queryResult))
    else block.append(text(el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'), queryError ?? 'Activity waits for a governed page query.'))
  } else if (node.component === 'RiskIndicator') {
    block.append(renderRiskDistribution(node, queryResult))
  } else if (node.component === 'Search') {
    block.append(renderSearch(node))
  } else if (node.component === 'Filter') {
    block.append(renderFilter(node, queryResult))
  } else if (node.component === 'ObjectPicker' || node.component === 'PeoplePicker') {
    block.append(renderPicker(node, queryResult))
  } else if (node.component === 'MetricCard') {
    if (queryResult) block.append(renderMetricCard(node, queryResult))
    else block.append(waitingForQuery(page, queryError, 'Metric waits for a governed page query.'))
  } else if (node.component === 'TaskList') {
    if (queryResult) block.append(renderTaskList(node, queryResult))
    else block.append(waitingForQuery(page, queryError, 'Tasks wait for a governed page query.'))
  } else if (node.component === 'FileViewer') {
    if (hostBound) {
      const mount = el('div')
      mount.dataset.pageFiles = ''
      block.append(mount)
    } else {
      if (queryResult) block.append(renderFileViewer(node, queryResult))
      else block.append(waitingForQuery(page, queryError, 'Files wait for a governed page query.'))
      block.append(text(el('p', 'enterprise-app-binding'), 'File open is supplied by the host adapter.'))
    }
  } else if (node.component === 'KnowledgeSearch') {
    if (hostBound) {
      const mount = el('div')
      mount.dataset.pageKnowledge = ''
      block.append(mount)
    } else {
      if (queryResult) block.append(renderKnowledgeSearch(node, queryResult))
      else block.append(waitingForQuery(page, queryError, 'Knowledge citations wait for a governed page query.'))
      block.append(text(el('p', 'enterprise-app-binding'), 'Knowledge search is supplied by the host adapter.'))
    }
  } else if (node.component === 'ActionButton') {
    block.append(renderActionButton(node, page))
  } else if (node.component === 'WorkflowStatus') {
    if (queryResult) block.append(renderWorkflowStatus(node, queryResult))
    else block.append(waitingForQuery(page, queryError, 'Workflow states wait for a governed page query.'))
  } else if (node.component === 'NotificationPanel') {
    if (queryResult) block.append(renderNotificationPanel(node, queryResult))
    else block.append(waitingForQuery(page, queryError, 'Notifications wait for a governed page query.'))
  } else if (node.component === 'AISummary' || node.component === 'AIComposer' || node.component === 'AIAssistant') {
    block.append(text(el('p', 'enterprise-app-binding'), 'AI authority stays in the validated OBIS × Harness runtime. This component cannot mint tools or credentials from page schema.'))
  }
  return block
}

function renderNode(
  node: DesktopApplicationUiNode,
  page: DesktopApplicationPageEnvelope,
  queryResult: DesktopApplicationQueryResult | undefined,
  queryError: string | undefined,
  hostBound: boolean,
): HTMLElement {
  if (!SUPPORTED_COMPONENTS.has(node.component)) return renderUnsupported(node)

  if (!STRUCTURAL_COMPONENTS.has(node.component) || node.component === 'Table') {
    const leaf = renderLeaf(node, page, queryResult, queryError, hostBound)
    for (const child of node.children ?? []) leaf.append(renderNode(child, page, queryResult, queryError, hostBound))
    return leaf
  }

  if (node.component === 'Tabs') {
    const host = el('section', componentClass(node.component))
    host.dataset.component = node.component
    const children = node.children ?? []
    const tabList = el('div', 'enterprise-app-tab-list')
    const panel = el('div', 'enterprise-app-tab-panel')
    const activate = (index: number): void => {
      panel.replaceChildren()
      const child = children[index]
      if (child) panel.append(renderNode(child, page, queryResult, queryError, hostBound))
      for (const [buttonIndex, button] of [...tabList.querySelectorAll<HTMLButtonElement>('button')].entries()) {
        button.setAttribute('aria-selected', String(buttonIndex === index))
      }
    }
    children.forEach((child, index) => {
      const button = text(el('button', 'enterprise-secondary-button'), scalarProp(child, 'label', 'title') ?? `Tab ${index + 1}`) as HTMLButtonElement
      button.type = 'button'
      button.setAttribute('role', 'tab')
      button.onclick = () => {
        activate(index)
      }
      tabList.append(button)
    })
    host.append(tabList, panel)
    activate(0)
    return host
  }

  if (node.component === 'Drawer' || node.component === 'Modal') {
    const host = el('section', componentClass(node.component))
    host.dataset.component = node.component
    const toggle = text(el('button', 'enterprise-secondary-button'), scalarProp(node, 'openLabel') ?? `Open ${node.component}`) as HTMLButtonElement
    toggle.type = 'button'
    toggle.setAttribute('aria-expanded', 'false')
    const panel = el('div', 'enterprise-app-disclosure-panel')
    panel.hidden = true
    for (const child of node.children ?? []) panel.append(renderNode(child, page, queryResult, queryError, hostBound))
    toggle.onclick = () => {
      panel.hidden = !panel.hidden
      toggle.setAttribute('aria-expanded', String(!panel.hidden))
      toggle.textContent = panel.hidden ? (scalarProp(node, 'openLabel') ?? `Open ${node.component}`) : `Close ${node.component}`
    }
    host.append(toggle, panel)
    return host
  }

  const tag = node.component === 'Form' ? 'form' : 'section'
  const host = el(tag, componentClass(node.component))
  host.dataset.component = node.component
  if (node.id) host.dataset.componentId = node.id
  if (tag === 'form') {
    host.addEventListener('submit', (event) => {
      event.preventDefault()
    })
  }
  const title = scalarProp(node, 'title', 'label')
  const description = scalarProp(node, 'description')
  if (title) host.append(text(el('h2', 'enterprise-app-section-title'), title))
  if (description) host.append(text(el('p', 'enterprise-app-component-copy'), description))
  if (node.component === 'Form') host.append(renderDeclarativeForm(node, page))
  for (const child of node.children ?? []) host.append(renderNode(child, page, queryResult, queryError, hostBound))
  return host
}

function actionApprovalId(result: DesktopApplicationActionResult): string | undefined {
  const output = result.output && typeof result.output === 'object' && !Array.isArray(result.output)
    ? result.output as Record<string, unknown>
    : undefined
  return typeof output?.approvalId === 'string' && output.approvalId.trim()
    ? output.approvalId.trim()
    : undefined
}

function actionMessage(result: DesktopApplicationActionResult): string {
  const output = result.output && typeof result.output === 'object' && !Array.isArray(result.output)
    ? result.output as Record<string, unknown>
    : undefined
  if (result.status === 'approval-required') {
    const approvalId = typeof output?.approvalId === 'string' ? output.approvalId : undefined
    return approvalId
      ? `Approval required · ${approvalId}. Approve it in the enterprise inbox, then retry this action.`
      : 'Approval required. Approve it in the enterprise inbox, then retry this action.'
  }
  if (result.status === 'executed') return 'Action executed through the governed OBIS Action Runtime.'
  return `${result.status} · ${result.decision.reason}`
}

interface RenderedActionForm {
  container: HTMLElement
  target: HTMLInputElement
  version: HTMLInputElement
  readInput: () => Record<string, unknown>
}

function actionFieldControl(
  name: string,
  field: DesktopApplicationActionField,
): HTMLInputElement | HTMLTextAreaElement {
  if (field.type === 'json') {
    const input = el('textarea', 'enterprise-app-action-field enterprise-app-action-json')
    input.placeholder = field.required ? 'Required JSON value' : 'Optional JSON value'
    input.setAttribute('aria-label', name)
    return input
  }
  const input = el('input', 'enterprise-app-action-field')
  input.setAttribute('aria-label', name)
  if (field.type === 'number' || field.type === 'integer') input.type = 'number'
  else if (field.type === 'boolean') input.type = 'checkbox'
  else if (field.type === 'datetime') input.type = 'datetime-local'
  else input.type = 'text'
  if (field.type === 'integer') input.step = '1'
  input.placeholder = field.ref ? `${field.type} · ${field.ref}` : field.type
  return input
}

function parseActionField(
  name: string,
  field: DesktopApplicationActionField,
  control: HTMLInputElement | HTMLTextAreaElement,
): unknown {
  if (field.type === 'boolean') {
    const checkbox = control as HTMLInputElement
    if (!field.required && !checkbox.checked) return undefined
    return checkbox.checked
  }
  const raw = control.value.trim()
  if (!raw) {
    if (field.required) throw new Error(`${name} is required.`)
    return undefined
  }
  if (field.type === 'number' || field.type === 'integer') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`)
    if (field.type === 'integer' && !Number.isInteger(value)) throw new Error(`${name} must be an integer.`)
    return value
  }
  if (field.type === 'json') {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new Error(`${name} must be valid JSON.`)
    }
  }
  return raw
}

function renderActionForm(binding: DesktopApplicationActionBinding): RenderedActionForm {
  const container = el('details', 'enterprise-app-action-input')
  container.dataset.actionForm = binding.name
  const summary = el('summary')
  summary.append(
    text(el('strong'), binding.name),
    text(el('span'), `${binding.target}${binding.risk ? ` · ${binding.risk} risk` : ''}`),
  )
  container.append(summary)

  if (binding.approval) {
    container.append(text(el('p', 'enterprise-app-binding'), `Approval gate · ${binding.approval}`))
  }

  const fields = el('div', 'enterprise-app-action-schema-fields')
  const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement>()
  for (const [name, field] of Object.entries(binding.input)) {
    const label = el('label', 'enterprise-app-action-schema-field')
    const caption = el('span')
    caption.append(
      text(el('strong'), name),
      text(el('small'), `${field.type}${field.required ? ' · required' : ' · optional'}${field.ref ? ` · ${field.ref}` : ''}`),
    )
    const control = actionFieldControl(name, field)
    controls.set(name, control)
    label.append(caption, control)
    fields.append(label)
  }
  if (!controls.size) fields.append(text(el('p', 'enterprise-app-empty-data'), 'This action has no input fields.'))

  const execution = el('div', 'enterprise-app-action-execution-fields')
  const target = el('input', 'enterprise-app-action-field')
  target.placeholder = 'Target object id (optional)'
  target.setAttribute('aria-label', 'Target object id')
  const version = el('input', 'enterprise-app-action-field')
  version.placeholder = 'Expected object version (optional)'
  version.setAttribute('aria-label', 'Expected object version')
  version.type = 'number'
  version.min = '1'
  version.step = '1'
  execution.append(target, version)
  container.append(fields, execution)

  return {
    container,
    target,
    version,
    readInput: () => {
      const result: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(binding.input)) {
        const control = controls.get(name)
        if (!control) continue
        const value = parseActionField(name, field, control)
        if (value !== undefined) result[name] = value
      }
      return result
    },
  }
}

interface RenderedQueryControls {
  container: HTMLElement
  apply: HTMLButtonElement
  clear: HTMLButtonElement
  readWhere: () => Record<string, unknown>
  reset: () => void
}

function renderQueryControls(
  query: NonNullable<DesktopApplicationPageEnvelope['runtime']>['query'],
): RenderedQueryControls | undefined {
  if (!query || query.filterable.length === 0) return undefined
  const container = el('section', 'enterprise-app-query-controls')
  const head = el('div', 'enterprise-app-query-head')
  head.append(
    text(el('span', 'enterprise-page-eyebrow'), 'GOVERNED FILTERS'),
    text(el('p', 'enterprise-app-binding'), `${query.object} · only active-IR filterable fields are exposed`),
  )
  container.append(head)

  const fields = el('div', 'enterprise-app-query-fields')
  const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement>()
  for (const name of query.filterable) {
    const schema = query.filters[name]
    if (!schema) continue
    const label = el('label', 'enterprise-app-action-schema-field')
    const caption = el('span')
    caption.append(
      text(el('strong'), name),
      text(el('small'), `${schema.type}${schema.ref ? ` · ${schema.ref}` : ''}`),
    )
    const control = actionFieldControl(name, { ...schema, required: false })
    control.setAttribute('data-query-filter', name)
    controls.set(name, control)
    label.append(caption, control)
    fields.append(label)
  }
  if (!controls.size) return undefined
  container.append(fields)

  const actions = el('div', 'enterprise-app-action-buttons')
  const apply = text(el('button', 'enterprise-secondary-button'), 'Apply filters') as HTMLButtonElement
  const clear = text(el('button', 'enterprise-secondary-button'), 'Clear') as HTMLButtonElement
  apply.type = 'button'
  clear.type = 'button'
  actions.append(apply, clear)
  container.append(actions)

  return {
    container,
    apply,
    clear,
    readWhere: () => {
      const where: Record<string, unknown> = {}
      for (const name of query.filterable) {
        const schema = query.filters[name]
        const control = controls.get(name)
        if (!schema || !control) continue
        const value = parseActionField(name, { ...schema, required: false }, control)
        if (value !== undefined) where[name] = value
      }
      return where
    },
    reset: () => {
      for (const control of controls.values()) {
        if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = false
        else control.value = ''
      }
    },
  }
}

function applicationAiContext(
  envelope: DesktopApplicationPageEnvelope,
  queryResult: DesktopApplicationQueryResult | undefined,
): Record<string, unknown> {
  return {
    module: {
      id: envelope.module.id,
      version: envelope.module.version,
      name: envelope.module.name,
    },
    page: {
      id: envelope.page.id,
      title: envelope.page.title,
    },
    ...(queryResult
      ? {
        data: {
          query: queryResult.query,
          ...(queryResult.object ? { object: queryResult.object } : {}),
          truncated: queryResult.truncated,
          items: queryResult.items.slice(0, 40).map(item => ({
            id: item.id,
            object: item.object,
            values: item.values,
            version: item.version,
          })),
        },
      }
      : {}),
  }
}

function hydrateApplicationAi(
  canvas: HTMLElement,
  envelope: DesktopApplicationPageEnvelope,
  runtime: DesktopApplicationRenderRuntime,
  queryResult: DesktopApplicationQueryResult | undefined,
): void {
  const context = applicationAiContext(envelope, queryResult)

  for (const block of canvas.querySelectorAll<HTMLElement>('[data-component="AISummary"]')) {
    const controls = el('div', 'enterprise-app-ai-controls')
    const button = text(el('button', 'enterprise-secondary-button'), 'Generate summary') as HTMLButtonElement
    const output = text(el('div', 'enterprise-app-ai-output'), 'Ready to summarize the governed data visible on this page.')
    const meta = el('small', 'enterprise-app-ai-meta')
    button.type = 'button'
    button.onclick = () => {
      void (async () => {
        button.disabled = true
        output.classList.remove('is-error')
        output.textContent = 'Generating governed summary…'
        meta.textContent = ''
        try {
          const result = await runtime.bridge.ai({
            ...runtime.scope,
            moduleId: envelope.module.id,
            pageId: envelope.page.id,
            mode: 'summary',
            context,
          })
          output.textContent = result.text
          meta.textContent = `${result.modelId} · trace ${result.traceId}`
        } catch (error) {
          output.textContent = error instanceof Error ? error.message : 'Application AI summary failed.'
          output.classList.add('is-error')
        } finally {
          button.disabled = false
        }
      })()
    }
    controls.append(button, output, meta)
    block.append(controls)
  }

  for (const block of canvas.querySelectorAll<HTMLElement>('[data-component="AIComposer"], [data-component="AIAssistant"]')) {
    const controls = el('div', 'enterprise-app-ai-controls')
    const prompt = el('textarea', 'enterprise-app-ai-prompt')
    const button = text(el('button', 'enterprise-secondary-button'), 'Draft with AI') as HTMLButtonElement
    const output = text(el('div', 'enterprise-app-ai-output'), 'AI can draft text from visible page context, but cannot execute actions.')
    const meta = el('small', 'enterprise-app-ai-meta')
    prompt.rows = 3
    prompt.maxLength = 12_000
    prompt.placeholder = 'Ask for an explanation, response, note or draft based on the governed data above…'
    prompt.setAttribute('aria-label', 'Application AI prompt')
    button.type = 'button'
    button.onclick = () => {
      void (async () => {
        const value = prompt.value.trim()
        if (!value) {
          output.textContent = 'Enter a prompt before asking AI to draft.'
          output.classList.add('is-error')
          return
        }
        button.disabled = true
        prompt.disabled = true
        output.classList.remove('is-error')
        output.textContent = 'Drafting from governed context…'
        meta.textContent = ''
        try {
          const result = await runtime.bridge.ai({
            ...runtime.scope,
            moduleId: envelope.module.id,
            pageId: envelope.page.id,
            mode: 'compose',
            prompt: value,
            context,
          })
          output.textContent = result.text
          meta.textContent = `${result.modelId} · trace ${result.traceId}`
        } catch (error) {
          output.textContent = error instanceof Error ? error.message : 'Application AI drafting failed.'
          output.classList.add('is-error')
        } finally {
          button.disabled = false
          prompt.disabled = false
        }
      })()
    }
    controls.append(prompt, button, output, meta)
    block.append(controls)
  }
}

export function moduleNavigationItems(records: readonly DesktopApplicationNavigationRecord[]): DesktopModuleNavigationItem[] {
  return records.map((record, index) => ({
    id: `module:${record.moduleId}:${record.id}`,
    label: record.label,
    kind: 'module',
    route: `/apps/${encodeURIComponent(record.moduleId)}/${encodeURIComponent(record.page)}`,
    icon: 'blocks',
    section: record.group ?? 'Apps',
    order: 1000 + index * 10,
    moduleId: record.moduleId,
    modulePageId: record.page,
    moduleVersion: record.moduleVersion,
  }))
}

export function isModuleNavigationItem(item: DesktopNavigationItem): item is DesktopModuleNavigationItem {
  const value = item as Partial<DesktopModuleNavigationItem>
  return item.kind === 'module'
    && typeof value.moduleId === 'string'
    && value.moduleId.length > 0
    && typeof value.modulePageId === 'string'
    && value.modulePageId.length > 0
    && typeof value.moduleVersion === 'string'
    && value.moduleVersion.length > 0
}

export function renderDesktopApplicationPreviewPage(
  host: HTMLElement,
  envelope: DesktopApplicationPreviewPageEnvelope,
): void {
  host.replaceChildren()
  const page = el('article', 'enterprise-application-page enterprise-application-preview')
  page.dataset.moduleId = envelope.module.id
  page.dataset.moduleVersion = envelope.module.version
  page.dataset.pageId = envelope.page.id
  page.dataset.previewId = envelope.preview.id

  const head = el('header', 'enterprise-application-head')
  const title = el('div')
  title.append(
    text(el('span', 'enterprise-page-eyebrow'), `PREVIEW · ${envelope.preview.persona.toUpperCase()} · r${envelope.preview.sourceRevision}`),
    text(el('h1'), envelope.page.title),
  )
  const authority = text(
    el('span', 'enterprise-app-authority'),
    envelope.permissions.visible
      ? `Preview · executable would be ${String(envelope.permissions.executable)} after publish`
      : 'Preview · hidden for this persona',
  )
  head.append(title, authority)
  page.append(head)

  const notice = el('section', 'enterprise-app-unsupported')
  notice.append(
    text(el('strong'), envelope.preview.workspace.infrastructureBacked ? 'Ephemeral governed preview workspace' : 'Immutable governed preview'),
    text(
      el('p'),
      envelope.preview.workspace.infrastructureBacked
        ? `Isolated workspace ${envelope.preview.workspace.namespace ?? envelope.preview.workspace.resourceId} · runtime ${envelope.preview.workspace.runtimeEnvironmentId} · expires ${envelope.preview.workspace.expiresAt}. UI rendering remains read-only until the exact module revision passes governance and is published.`
        : 'This view renders the draft UI schema and entitlement result only. Query, Action, Approval and AI execution are disabled until the exact module revision passes governance and is published.',
    ),
  )
  page.append(notice)

  const contractIssues = validateDesktopApplicationContract(envelope.page, envelope.designSystem)
  if (contractIssues.length) {
    page.append(renderContractIssues(contractIssues))
    host.append(page)
    return
  }

  const canvas = el('div', 'enterprise-application-canvas')
  stampRendererContract(canvas)
  const previewPage: DesktopApplicationPageEnvelope = {
    module: envelope.module,
    page: envelope.page,
    designSystem: envelope.designSystem,
    permissions: envelope.permissions,
  }
  canvas.append(renderNode(envelope.page.layout, previewPage, undefined, undefined, false))
  page.append(canvas)
  host.append(page)
}

export async function renderDesktopApplicationPage(
  host: HTMLElement,
  envelope: DesktopApplicationPageEnvelope,
  runtime: DesktopApplicationRenderRuntime,
): Promise<void> {
  host.replaceChildren()
  const page = el('article', 'enterprise-application-page')
  page.dataset.moduleId = envelope.module.id
  page.dataset.moduleVersion = envelope.module.version
  page.dataset.pageId = envelope.page.id

  const head = el('header', 'enterprise-application-head')
  const title = el('div')
  title.append(
    text(el('span', 'enterprise-page-eyebrow'), `${envelope.module.name} · ${envelope.module.version}`),
    text(el('h1'), envelope.page.title),
  )
  const authority = text(
    el('span', 'enterprise-app-authority'),
    envelope.permissions.executable ? 'Governed · executable' : 'Governed · read only',
  )
  head.append(title, authority)
  page.append(head)

  const contractIssues = validateDesktopApplicationContract(envelope.page, envelope.designSystem)
  if (contractIssues.length) {
    page.append(renderContractIssues(contractIssues))
    host.append(page)
    return
  }

  let queryResult: DesktopApplicationQueryResult | undefined
  let queryError: string | undefined
  let sourceStatus: HTMLElement | undefined
  let queryControls: RenderedQueryControls | undefined
  let inboxState: PageInboxState | undefined
  let catalogState: PageCatalogState | undefined
  const canvas = el('div', 'enterprise-application-canvas')
  stampRendererContract(canvas)

  async function loadInbox(): Promise<void> {
    const wantsTasks = layoutHasComponent(envelope.page.layout, 'TaskList')
    const wantsApprovals = layoutHasComponent(envelope.page.layout, 'ApprovalQueue')
    if (!wantsTasks && !wantsApprovals) {
      inboxState = undefined
      return
    }
    const next: PageInboxState = { tasks: [], approvals: [] }
    if (wantsTasks) {
      try {
        next.tasks = (await runtime.bridge.tasks(runtime.scope)).items
      } catch (error) {
        next.tasksError = error instanceof Error ? error.message : 'The entitled task inbox failed.'
      }
    }
    if (wantsApprovals) {
      try {
        next.approvals = (await runtime.bridge.approvalInbox(runtime.scope)).waitingForMe
      } catch (error) {
        next.approvalsError = error instanceof Error ? error.message : 'The entitled approval inbox failed.'
      }
    }
    inboxState = next
  }

  async function loadCatalog(): Promise<void> {
    if (!layoutHasComponent(envelope.page.layout, 'KnowledgeSearch')) {
      catalogState = undefined
      return
    }
    try {
      catalogState = {
        items: (await runtime.bridge.searchKnowledge({
          ...runtime.scope,
          query: envelope.page.title,
        })).items,
      }
    } catch (error) {
      catalogState = {
        items: [],
        error: error instanceof Error ? error.message : 'The entitled knowledge search failed.',
      }
    }
  }

  async function reloadInbox(): Promise<void> {
    await loadInbox()
    renderCanvas()
  }

  function renderCanvas(): void {
    canvas.replaceChildren(renderNode(envelope.page.layout, envelope, queryResult, queryError, true))
    hydrateApplicationAi(canvas, envelope, runtime, queryResult)
    bindLayoutActionButtons(page)
    hydrateEntitledInbox(canvas, inboxState, envelope, runtime, reloadInbox)
    hydrateEntitledCatalog(canvas, envelope, queryResult, queryError, catalogState)
  }

  const runPageQuery = async (where?: Record<string, unknown>): Promise<void> => {
    const runtimeLimit = envelope.runtime?.query?.maxLimit
      ? Math.min(250, envelope.runtime.query.maxLimit)
      : 250
    if (sourceStatus) {
      sourceStatus.textContent = 'Loading…'
      sourceStatus.classList.remove('is-error')
    }
    try {
      queryResult = await runtime.bridge.query({
        ...runtime.scope,
        moduleId: envelope.module.id,
        pageId: envelope.page.id,
        limit: runtimeLimit,
        ...(where && Object.keys(where).length ? { where } : {}),
      })
      queryError = undefined
      if (sourceStatus) {
        sourceStatus.textContent = `${queryResult.items.length} records${queryResult.truncated ? ' · bounded' : ''}`
      }
    } catch (error) {
      queryError = error instanceof Error ? error.message : 'The governed page query failed.'
      if (sourceStatus) {
        sourceStatus.textContent = 'Query unavailable'
        sourceStatus.classList.add('is-error')
      }
    }
    renderCanvas()
  }

  if (envelope.page.source?.query) {
    const source = el('div', 'enterprise-app-source')
    sourceStatus = text(el('span', 'enterprise-app-source-status'), 'Loading…')
    source.append(
      text(el('span'), 'GOVERNED DATA'),
      text(el('code'), envelope.page.source.query),
      sourceStatus,
    )
    page.append(source)
    if (envelope.runtime?.query) {
      queryControls = renderQueryControls(envelope.runtime.query)
      if (queryControls) {
        queryControls.apply.onclick = () => {
          try {
            const where = queryControls?.readWhere() ?? {}
            void runPageQuery(where)
          } catch (error) {
            queryError = error instanceof Error ? error.message : 'Query filter is invalid.'
            if (sourceStatus) {
              sourceStatus.textContent = 'Invalid filter'
              sourceStatus.classList.add('is-error')
            }
            renderCanvas()
          }
        }
        queryControls.clear.onclick = () => {
          queryControls?.reset()
          void runPageQuery()
        }
        page.append(queryControls.container)
      }
    }
    host.append(page)
    await runPageQuery()
  } else {
    host.append(page)
  }

  await Promise.all([loadInbox(), loadCatalog()])
  renderCanvas()
  page.append(canvas)

  if ((envelope.page.actions?.length ?? 0) > 0) {
    const actionBar = el('footer', 'enterprise-app-actions')
    const actionHead = el('div', 'enterprise-app-action-head')
    actionHead.append(
      text(el('span', 'enterprise-page-eyebrow'), 'GOVERNED ACTIONS'),
      text(
        el('p', 'enterprise-app-binding'),
        'Inputs are generated from the active deployment IR. Page schema cannot invent fields or execution authority.',
      ),
    )
    actionBar.append(actionHead)

    const actionStatus = text(el('p', 'enterprise-app-action-status'), 'Ready')
    const retryKeys = new Map<string, string>()
    const actionButtons: HTMLButtonElement[] = []
    const bindings = new Map((envelope.runtime?.actions ?? []).map(binding => [binding.name, binding]))

    for (const action of envelope.page.actions ?? []) {
      const binding = bindings.get(action)
      if (!binding) {
        const unsupported = el('section', 'enterprise-app-unsupported')
        unsupported.append(
          text(el('strong'), action),
          text(el('p'), 'The active deployment did not provide a governed input schema for this page action.'),
        )
        actionBar.append(unsupported)
        continue
      }

      const form = renderActionForm(binding)
      const execute = text(el('button', 'enterprise-secondary-button'), `Execute ${action}`) as HTMLButtonElement
      const approvalPanel = el('div', 'enterprise-app-approval-panel')
      let pending: {
        input: Record<string, unknown>
        targetId?: string
        expectedVersion?: number
        idempotencyKey: string
        approvalId: string
      } | undefined

      execute.type = 'button'
      execute.disabled = !envelope.permissions.executable
      actionButtons.push(execute)

      const perform = async (execution: {
        input: Record<string, unknown>
        targetId?: string
        expectedVersion?: number
        idempotencyKey?: string
      }): Promise<void> => {
        for (const button of actionButtons) button.disabled = true
        actionStatus.classList.remove('is-error')
        actionStatus.textContent = `Executing ${action} through OBIS…`
        try {
          const result = await runtime.bridge.action({
            ...runtime.scope,
            moduleId: envelope.module.id,
            pageId: envelope.page.id,
            action,
            input: execution.input,
            ...(execution.targetId ? { targetId: execution.targetId } : {}),
            ...(execution.expectedVersion !== undefined ? { expectedVersion: execution.expectedVersion } : {}),
            ...(execution.idempotencyKey ? { idempotencyKey: execution.idempotencyKey } : {}),
          })
          actionStatus.textContent = actionMessage(result)

          if (result.status === 'approval-required') {
            const approvalId = actionApprovalId(result)
            if (!approvalId) {
              actionStatus.textContent = 'Action requires approval, but OBIS returned no approval id.'
              actionStatus.classList.add('is-error')
              return
            }
            retryKeys.set(action, result.idempotencyKey)
            pending = {
              input: structuredClone(execution.input),
              ...(execution.targetId ? { targetId: execution.targetId } : {}),
              ...(execution.expectedVersion !== undefined ? { expectedVersion: execution.expectedVersion } : {}),
              idempotencyKey: result.idempotencyKey,
              approvalId,
            }

            const approvalText = text(
              el('span', 'enterprise-app-approval-copy'),
              `Approval ${approvalId} is pending.`,
            )
            const refreshApproval = text(
              el('button', 'enterprise-secondary-button'),
              'Refresh approval',
            ) as HTMLButtonElement
            refreshApproval.type = 'button'
            refreshApproval.onclick = () => {
              void (async () => {
                if (!pending) return
                refreshApproval.disabled = true
                try {
                  const status = await runtime.bridge.approval({
                    ...runtime.scope,
                    approvalId: pending.approvalId,
                  })
                  approvalText.textContent = `${status.gate} · ${status.status} · stage ${status.currentStage.name ?? status.currentStage.id} · ${status.currentStage.approvals}/${status.currentStage.quorum} approvals`
                  if (status.status === 'approved') {
                    const replay = pending
                    pending = undefined
                    approvalPanel.replaceChildren()
                    await perform({
                      input: replay.input,
                      ...(replay.targetId ? { targetId: replay.targetId } : {}),
                      ...(replay.expectedVersion !== undefined ? { expectedVersion: replay.expectedVersion } : {}),
                      idempotencyKey: replay.idempotencyKey,
                    })
                  } else if (status.status !== 'pending') {
                    pending = undefined
                    retryKeys.delete(action)
                    actionStatus.textContent = `Approval ${status.id} is ${status.status}; the action will not execute.`
                    actionStatus.classList.add('is-error')
                  }
                } catch (error) {
                  approvalText.textContent = error instanceof Error
                    ? error.message
                    : 'Unable to refresh approval status.'
                  approvalText.classList.add('is-error')
                } finally {
                  refreshApproval.disabled = false
                }
              })()
            }
            approvalPanel.replaceChildren(approvalText, refreshApproval)
          } else {
            pending = undefined
            retryKeys.delete(action)
            approvalPanel.replaceChildren()
          }

          if (result.status === 'executed' && envelope.page.source?.query) {
            const where = queryControls?.readWhere()
            await runPageQuery(where)
          }
          if (result.status !== 'executed' && result.status !== 'approval-required') {
            actionStatus.classList.add('is-error')
          }
        } catch (error) {
          actionStatus.textContent = error instanceof Error ? error.message : 'The governed action failed.'
          actionStatus.classList.add('is-error')
        } finally {
          for (const button of actionButtons) button.disabled = !envelope.permissions.executable
        }
      }

      execute.onclick = () => {
        void (async () => {
          let actionInput: Record<string, unknown>
          try {
            actionInput = form.readInput()
          } catch (error) {
            actionStatus.textContent = error instanceof Error ? error.message : 'Action input is invalid.'
            actionStatus.classList.add('is-error')
            return
          }
          const expectedVersion = form.version.value ? Number(form.version.value) : undefined
          if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
            actionStatus.textContent = 'Expected version must be a positive integer.'
            actionStatus.classList.add('is-error')
            return
          }
          const retryKey = retryKeys.get(action)
          await perform({
            input: actionInput,
            ...(form.target.value.trim() ? { targetId: form.target.value.trim() } : {}),
            ...(expectedVersion !== undefined ? { expectedVersion } : {}),
            ...(retryKey ? { idempotencyKey: retryKey } : {}),
          })
        })()
      }

      const controls = el('div', 'enterprise-app-action-buttons')
      controls.append(execute)
      form.container.append(controls, approvalPanel)
      actionBar.append(form.container)
    }
    actionBar.append(actionStatus)
    page.append(actionBar)
  }

  bindLayoutActionButtons(page)
  if (!host.contains(page)) host.append(page)
}
