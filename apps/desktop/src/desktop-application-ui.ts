import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import type { DesktopNavigationItem } from './desktop-obis-identity-shared.ts'
import type {
  DesktopApplicationActionResult,
  DesktopApplicationBridge,
  DesktopApplicationNavigationRecord,
  DesktopApplicationPageEnvelope,
  DesktopApplicationQueryItem,
  DesktopApplicationQueryResult,
  DesktopApplicationUiNode,
  DesktopModuleNavigationItem,
} from './desktop-application-shared.ts'

const STRUCTURAL_COMPONENTS = new Set([
  'Page', 'Section', 'Stack', 'Grid', 'Form', 'Table', 'Tabs', 'Drawer', 'Modal', 'Dashboard', 'Detail',
])
const ENTERPRISE_COMPONENTS = new Set([
  'Chart', 'Search', 'Filter', 'DataTable', 'ObjectDetail', 'ObjectPicker', 'PeoplePicker', 'ApprovalQueue',
  'Timeline', 'ActivityFeed', 'RiskIndicator', 'AISummary', 'AIComposer',
])
const SUPPORTED_COMPONENTS = new Set([...STRUCTURAL_COMPONENTS, ...ENTERPRISE_COMPONENTS])

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

function renderLeaf(
  node: DesktopApplicationUiNode,
  page: DesktopApplicationPageEnvelope,
  queryResult: DesktopApplicationQueryResult | undefined,
  queryError: string | undefined,
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
  } else if (node.component === 'ObjectDetail') {
    if (queryResult) block.append(renderObjectDetail(queryResult.items[0]))
    else block.append(text(el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'), queryError ?? 'Object detail waits for a governed page query.'))
  } else if (node.component === 'Chart') {
    if (queryResult) block.append(renderChart(queryResult))
    else block.append(text(el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'), queryError ?? 'Chart waits for a governed page query.'))
  } else if (node.component === 'Timeline' || node.component === 'ActivityFeed') {
    if (queryResult) block.append(renderActivity(queryResult))
    else block.append(text(el('p', queryError ? 'enterprise-app-runtime-error' : 'enterprise-app-binding'), queryError ?? 'Activity waits for a governed page query.'))
  } else if (node.component === 'RiskIndicator' && queryResult?.items[0]) {
    const risk = queryResult.items[0].values.risk ?? queryResult.items[0].values.riskLevel ?? queryResult.items[0].values.status
    block.append(text(el('strong', 'enterprise-app-component-value'), displayValue(risk ?? 'Available')))
  } else if (node.component === 'AISummary' || node.component === 'AIComposer') {
    block.append(text(el('p', 'enterprise-app-binding'), 'AI authority stays in the validated OBIS × Harness runtime. This component cannot mint tools or credentials from page schema.'))
  }
  return block
}

function renderNode(
  node: DesktopApplicationUiNode,
  page: DesktopApplicationPageEnvelope,
  queryResult: DesktopApplicationQueryResult | undefined,
  queryError: string | undefined,
): HTMLElement {
  if (!SUPPORTED_COMPONENTS.has(node.component)) return renderUnsupported(node)

  if (!STRUCTURAL_COMPONENTS.has(node.component) || node.component === 'Table') {
    const leaf = renderLeaf(node, page, queryResult, queryError)
    for (const child of node.children ?? []) leaf.append(renderNode(child, page, queryResult, queryError))
    return leaf
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
  if (title) host.append(text(el('h2', 'enterprise-app-section-title'), title))
  for (const child of node.children ?? []) host.append(renderNode(child, page, queryResult, queryError))
  return host
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

  if (envelope.designSystem.id !== 'obis-enterprise') {
    const blocked = el('section', 'enterprise-app-unsupported')
    blocked.append(
      text(el('strong'), 'Unsupported design system'),
      text(el('p'), `This Desktop build cannot render ${envelope.designSystem.id}@${envelope.designSystem.version}.`),
    )
    page.append(blocked)
    host.append(page)
    return
  }

  let queryResult: DesktopApplicationQueryResult | undefined
  let queryError: string | undefined
  if (envelope.page.source?.query) {
    const source = el('div', 'enterprise-app-source')
    source.append(
      text(el('span'), 'GOVERNED DATA'),
      text(el('code'), envelope.page.source.query),
      text(el('span', 'enterprise-app-source-status'), 'Loading…'),
    )
    page.append(source)
    host.append(page)
    try {
      queryResult = await runtime.bridge.query({
        ...runtime.scope,
        moduleId: envelope.module.id,
        pageId: envelope.page.id,
        limit: 250,
      })
      const status = source.querySelector<HTMLElement>('.enterprise-app-source-status')
      if (status) status.textContent = `${queryResult.items.length} records${queryResult.truncated ? ' · bounded' : ''}`
    } catch (error) {
      queryError = error instanceof Error ? error.message : 'The governed page query failed.'
      const status = source.querySelector<HTMLElement>('.enterprise-app-source-status')
      if (status) {
        status.textContent = 'Query unavailable'
        status.classList.add('is-error')
      }
    }
  } else {
    host.append(page)
  }

  const canvas = el('div', 'enterprise-application-canvas')
  const renderCanvas = (): void => {
    canvas.replaceChildren(renderNode(envelope.page.layout, envelope, queryResult, queryError))
  }
  renderCanvas()
  page.append(canvas)

  if ((envelope.page.actions?.length ?? 0) > 0) {
    const actionBar = el('footer', 'enterprise-app-actions')
    const actionHead = el('div', 'enterprise-app-action-head')
    actionHead.append(
      text(el('span', 'enterprise-page-eyebrow'), 'GOVERNED ACTIONS'),
      text(el('p', 'enterprise-app-binding'), 'Page actions can only execute names declared by the published module and this page.'),
    )
    actionBar.append(actionHead)

    const details = el('details', 'enterprise-app-action-input')
    const summary = text(el('summary'), 'Action input')
    const input = el('textarea', 'enterprise-app-json-input')
    input.value = '{}'
    input.spellcheck = false
    input.setAttribute('aria-label', 'Action input JSON object')
    const target = el('input', 'enterprise-app-action-field')
    target.placeholder = 'Target object id (optional)'
    const version = el('input', 'enterprise-app-action-field')
    version.placeholder = 'Expected object version (optional)'
    version.type = 'number'
    version.min = '1'
    details.append(summary, input, target, version)
    actionBar.append(details)

    const buttons = el('div', 'enterprise-app-action-buttons')
    const actionStatus = text(el('p', 'enterprise-app-action-status'), 'Ready')
    const retryKeys = new Map<string, string>()

    for (const action of envelope.page.actions ?? []) {
      const button = text(el('button', 'enterprise-secondary-button'), action) as HTMLButtonElement
      button.type = 'button'
      button.disabled = !envelope.permissions.executable
      button.onclick = () => {
        void (async () => {
          let actionInput: unknown
          try {
            actionInput = JSON.parse(input.value) as unknown
          } catch {
            actionStatus.textContent = 'Action input must be valid JSON.'
            actionStatus.classList.add('is-error')
            return
          }
          if (!actionInput || typeof actionInput !== 'object' || Array.isArray(actionInput)) {
            actionStatus.textContent = 'Action input must be a JSON object.'
            actionStatus.classList.add('is-error')
            return
          }
          const expectedVersion = version.value ? Number(version.value) : undefined
          if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
            actionStatus.textContent = 'Expected version must be a positive integer.'
            actionStatus.classList.add('is-error')
            return
          }

          for (const candidate of buttons.querySelectorAll<HTMLButtonElement>('button')) candidate.disabled = true
          actionStatus.classList.remove('is-error')
          actionStatus.textContent = `Executing ${action} through OBIS…`
          try {
            const retryKey = retryKeys.get(action)
            const result = await runtime.bridge.action({
              ...runtime.scope,
              moduleId: envelope.module.id,
              pageId: envelope.page.id,
              action,
              input: actionInput as Record<string, unknown>,
              ...(target.value.trim() ? { targetId: target.value.trim() } : {}),
              ...(expectedVersion !== undefined ? { expectedVersion } : {}),
              ...(retryKey ? { idempotencyKey: retryKey } : {}),
            })
            actionStatus.textContent = actionMessage(result)
            if (result.status === 'approval-required') retryKeys.set(action, result.idempotencyKey)
            else retryKeys.delete(action)
            if (result.status === 'executed' && envelope.page.source?.query) {
              queryResult = await runtime.bridge.query({
                ...runtime.scope,
                moduleId: envelope.module.id,
                pageId: envelope.page.id,
                limit: 250,
              })
              queryError = undefined
              renderCanvas()
            }
            if (result.status !== 'executed' && result.status !== 'approval-required') actionStatus.classList.add('is-error')
          } catch (error) {
            actionStatus.textContent = error instanceof Error ? error.message : 'The governed action failed.'
            actionStatus.classList.add('is-error')
          } finally {
            for (const candidate of buttons.querySelectorAll<HTMLButtonElement>('button')) {
              candidate.disabled = !envelope.permissions.executable
            }
          }
        })()
      }
      buttons.append(button)
    }
    actionBar.append(buttons, actionStatus)
    page.append(actionBar)
  }

  if (!host.contains(page)) host.append(page)
}
