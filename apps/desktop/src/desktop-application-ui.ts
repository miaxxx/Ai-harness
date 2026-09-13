import type { DesktopNavigationItem } from './desktop-obis-identity-shared.ts'
import type {
  DesktopApplicationNavigationRecord,
  DesktopApplicationPageEnvelope,
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

function renderLeaf(node: DesktopApplicationUiNode, page: DesktopApplicationPageEnvelope): HTMLElement {
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
    const source = page.page.source?.query
    block.append(text(
      el('p', 'enterprise-app-binding'),
      source ? `Governed query binding · ${source}` : 'No governed query binding declared for this table.',
    ))
  } else if (node.component === 'Chart') {
    block.append(text(el('p', 'enterprise-app-binding'), 'Chart rendering is declarative. Series data must arrive through the governed page query binding.'))
  } else if (node.component === 'AISummary' || node.component === 'AIComposer') {
    block.append(text(el('p', 'enterprise-app-binding'), 'AI execution authority remains in the validated OBIS × Harness runtime scope.'))
  }
  return block
}

function renderNode(node: DesktopApplicationUiNode, page: DesktopApplicationPageEnvelope): HTMLElement {
  if (!SUPPORTED_COMPONENTS.has(node.component)) return renderUnsupported(node)

  if (!STRUCTURAL_COMPONENTS.has(node.component) || node.component === 'Table') {
    const leaf = renderLeaf(node, page)
    for (const child of node.children ?? []) leaf.append(renderNode(child, page))
    return leaf
  }

  const tag = node.component === 'Form' ? 'form' : 'section'
  const host = el(tag, componentClass(node.component))
  host.dataset.component = node.component
  if (node.id) host.dataset.componentId = node.id
  const title = scalarProp(node, 'title', 'label')
  if (title) host.append(text(el('h2', 'enterprise-app-section-title'), title))
  for (const child of node.children ?? []) host.append(renderNode(child, page))
  return host
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

export function renderDesktopApplicationPage(host: HTMLElement, envelope: DesktopApplicationPageEnvelope): void {
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

  if (envelope.page.source?.query) {
    const source = el('div', 'enterprise-app-source')
    source.append(
      text(el('span'), 'DATA SOURCE'),
      text(el('code'), envelope.page.source.query),
    )
    page.append(source)
  }

  const canvas = el('div', 'enterprise-application-canvas')
  canvas.append(renderNode(envelope.page.layout, envelope))
  page.append(canvas)

  if ((envelope.page.actions?.length ?? 0) > 0) {
    const actionBar = el('footer', 'enterprise-app-actions')
    actionBar.append(text(el('span', 'enterprise-page-eyebrow'), 'DECLARED ACTIONS'))
    for (const action of envelope.page.actions ?? []) {
      const button = text(el('button', 'enterprise-secondary-button'), action) as HTMLButtonElement
      button.type = 'button'
      button.disabled = true
      button.title = 'The action is declared by the module. Interactive Action Runtime binding is not enabled in this renderer yet.'
      actionBar.append(button)
    }
    page.append(actionBar)
  }

  host.append(page)
}
