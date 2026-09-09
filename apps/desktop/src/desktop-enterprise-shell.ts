import type {
  DesktopEnterpriseContext,
  DesktopEnterpriseTenantContext,
  DesktopNavigationItem,
  DesktopResolvedWorkspace,
  DesktopUserPreference,
  DesktopWorkspaceDefinitionInput,
} from './desktop-obis-identity-shared.ts'
import { renderEnterpriseControlCenter } from './desktop-enterprise-overview-ui.ts'
import './desktop-enterprise-shell.css'

type ProductUnmount = () => void
type ProductMount = (container: HTMLElement) => Promise<ProductUnmount>

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function text(node: HTMLElement, value: string): HTMLElement {
  node.textContent = value
  return node
}

function icon(kind: string): string {
  const values: Record<string, string> = {
    plus: '＋',
    users: '⌘',
    bot: '◇',
    blocks: '⌗',
    clock: '◷',
    book: '▢',
    sliders: '≡',
  }
  return values[kind] ?? '○'
}

function selectedTenant(context: DesktopEnterpriseContext): DesktopEnterpriseTenantContext {
  const tenant = context.tenants.find(item => item.id === context.currentTenantId)
  if (!tenant) throw new Error('The active OBIS tenant is unavailable in Desktop context.')
  return tenant
}

function copyWorkspaceInput(workspace: DesktopResolvedWorkspace): DesktopWorkspaceDefinitionInput {
  return {
    name: 'Enterprise desktop',
    enabled: true,
    priority: 100,
    targets: {},
    branding: { ...workspace.branding },
    navigation: workspace.navigation.map(item => ({ ...item })),
    contextPane: { ...workspace.contextPane },
    homeRoute: workspace.homeRoute,
  }
}

function ordered(items: DesktopNavigationItem[]): DesktopNavigationItem[] {
  return [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

function replace<T>(array: T[], index: number, value: T): T[] {
  const next = [...array]
  next[index] = value
  return next
}

function renderEmptyOutlet(host: HTMLElement, title: string, copy: string): void {
  host.replaceChildren()
  const wrap = el('section', 'enterprise-empty-page')
  wrap.append(
    text(el('p', 'enterprise-page-eyebrow'), 'ENTERPRISE WORKSPACE'),
    text(el('h1'), title),
    text(el('p', 'enterprise-empty-copy'), copy),
  )
  host.append(wrap)
}

function renderContextPane(host: HTMLElement, workspace: DesktopResolvedWorkspace, tenant: DesktopEnterpriseTenantContext): void {
  host.replaceChildren()
  const header = el('div', 'enterprise-context-header')
  const fallback = workspace.contextPane.mode === 'team'
    ? 'Team'
    : workspace.contextPane.mode === 'assistants'
      ? 'Assistants'
      : workspace.contextPane.mode === 'module'
        ? 'Module'
        : 'Workspace'
  header.append(text(el('strong'), workspace.contextPane.title ?? fallback))
  host.append(header)
  if (workspace.contextPane.mode === 'none') return

  const sections = el('div', 'enterprise-context-sections')
  if (workspace.contextPane.mode === 'team') {
    const block = el('section', 'enterprise-context-block')
    block.append(
      text(el('span', 'enterprise-context-kicker'), 'ORGANIZATION'),
      text(el('h3'), tenant.displayName),
      text(el('p'), 'People and organization data are resolved from OBIS. Directory records are never fabricated by the Desktop client.'),
    )
    sections.append(block)
  } else if (workspace.contextPane.mode === 'assistants') {
    const block = el('section', 'enterprise-context-block')
    block.append(
      text(el('span', 'enterprise-context-kicker'), 'AI WORKFORCE'),
      text(el('h3'), 'Enterprise assistants'),
      text(el('p'), 'Assistants, skills and modules can be assigned here by enterprise configuration and role.'),
    )
    sections.append(block)
  } else if (workspace.contextPane.mode === 'module') {
    const block = el('section', 'enterprise-context-block')
    block.append(
      text(el('span', 'enterprise-context-kicker'), 'MODULE'),
      text(el('h3'), workspace.contextPane.moduleId ?? 'Enterprise module'),
      text(el('p'), 'This pane is controlled by the installed OBIS Module and its declared Desktop surface.'),
    )
    sections.append(block)
  } else {
    const projects = el('section', 'enterprise-context-block')
    projects.append(text(el('span', 'enterprise-context-kicker'), 'PROJECTS'))
    for (const project of tenant.projects.slice(0, 8)) {
      const row = el('div', 'enterprise-context-row')
      row.append(text(el('span'), project.name))
      projects.append(row)
    }
    sections.append(projects)
  }
  host.append(sections)
}

function openPreferenceEditor(input: { workspace: DesktopResolvedWorkspace; onSave: (next: DesktopUserPreference) => Promise<void> }): void {
  document.querySelector('.enterprise-sheet-backdrop')?.remove()
  const backdrop = el('div', 'enterprise-sheet-backdrop')
  const sheet = el('aside', 'enterprise-sheet')
  const head = el('header', 'enterprise-sheet-head')
  const close = text(el('button', 'enterprise-icon-button'), '×') as HTMLButtonElement
  close.type = 'button'
  close.onclick = () =>{  backdrop.remove() }
  head.append(text(el('div'), 'Personalize workspace'), close)
  sheet.append(
    head,
    text(el('p', 'enterprise-sheet-copy'), 'You can reorder visible entries and hide only entries the enterprise marked as optional. Permissions and enterprise-managed entries cannot be changed here.'),
  )

  let items = ordered(input.workspace.navigation)
  const hidden = new Set(input.workspace.preferences.hiddenOptionalIds)
  const list = el('div', 'enterprise-editor-list')
  const draw = (): void => {
    list.replaceChildren()
    items.forEach((item, index) => {
      const row = el('div', 'enterprise-editor-row')
      const controls = el('div', 'enterprise-editor-controls')
      const up = text(el('button'), '↑') as HTMLButtonElement
      const down = text(el('button'), '↓') as HTMLButtonElement
      up.type = down.type = 'button'
      up.disabled = index === 0
      down.disabled = index === items.length - 1
      up.onclick = () => {
        if (index === 0) return
        const next = [...items]
        const [moved] = next.splice(index, 1)
        if (moved) next.splice(index - 1, 0, moved)
        items = next
        draw()
      }
      down.onclick = () => {
        if (index === items.length - 1) return
        const next = [...items]
        const [moved] = next.splice(index, 1)
        if (moved) next.splice(index + 1, 0, moved)
        items = next
        draw()
      }
      controls.append(up, down)
      if (item.optional) {
        const toggle = el('input')
        toggle.type = 'checkbox'
        toggle.checked = !hidden.has(item.id)
        toggle.title = 'Show this optional entry'
        toggle.onchange = () => {
          if (toggle.checked) hidden.delete(item.id)
          else hidden.add(item.id)
        }
        controls.append(toggle)
      }
      row.append(text(el('span'), item.label), controls)
      list.append(row)
    })
  }
  draw()
  sheet.append(list)

  const save = text(el('button', 'enterprise-primary-button'), 'Save preferences') as HTMLButtonElement
  save.type = 'button'
  save.onclick = () => {
    save.disabled = true
    void window.dshEnterprise.savePreferences({
      pinnedIds: input.workspace.preferences.pinnedIds,
      hiddenOptionalIds: [...hidden],
      navigationOrder: items.map(item => item.id),
      ...(input.workspace.preferences.defaultProjectId ? { defaultProjectId: input.workspace.preferences.defaultProjectId } : {}),
      ...(input.workspace.preferences.defaultEnvironmentId ? { defaultEnvironmentId: input.workspace.preferences.defaultEnvironmentId } : {}),
    }).then(async (value) => {
      await input.onSave(value)
      backdrop.remove()
    }).finally(() => { save.disabled = false })
  }
  sheet.append(save)
  backdrop.append(sheet)
  document.body.append(backdrop)
}

function openAdminEditor(input: { workspace: DesktopResolvedWorkspace; onSaved: () => Promise<void> }): void {
  document.querySelector('.enterprise-sheet-backdrop')?.remove()
  const draft = copyWorkspaceInput(input.workspace)
  const backdrop = el('div', 'enterprise-sheet-backdrop')
  const sheet = el('aside', 'enterprise-sheet enterprise-admin-sheet')
  const head = el('header', 'enterprise-sheet-head')
  const close = text(el('button', 'enterprise-icon-button'), '×') as HTMLButtonElement
  close.type = 'button'
  close.onclick = () =>{  backdrop.remove() }
  head.append(text(el('div'), 'Manage enterprise desktop'), close)
  sheet.append(
    head,
    text(el('p', 'enterprise-sheet-copy'), 'This publishes a tenant-governed shell definition. It can change labels, ordering, visibility targets and branding, but it cannot grant permissions that OBIS does not already grant.'),
  )

  const brandLabel = text(el('label', 'enterprise-field-label'), 'Product name')
  const brand = el('input', 'enterprise-input')
  brand.value = draft.branding.productName
  brand.oninput = () => { draft.branding.productName = brand.value }
  brandLabel.append(brand)
  sheet.append(brandLabel)

  const paneLabel = text(el('label', 'enterprise-field-label'), 'Secondary pane')
  const pane = el('select', 'enterprise-input')
  for (const mode of ['none', 'spaces', 'team', 'assistants', 'module'] as const) {
    const option = el('option')
    option.value = mode
    option.textContent = mode
    option.selected = draft.contextPane.mode === mode
    pane.append(option)
  }
  pane.onchange = () => {
    draft.contextPane = { ...draft.contextPane, mode: pane.value as DesktopWorkspaceDefinitionInput['contextPane']['mode'] }
  }
  paneLabel.append(pane)
  sheet.append(paneLabel)

  let items = ordered(draft.navigation)
  const list = el('div', 'enterprise-editor-list')
  const draw = (): void => {
    list.replaceChildren()
    items.forEach((item, index) => {
      const row = el('div', 'enterprise-admin-row')
      const main = el('div', 'enterprise-admin-row-main')
      const name = el('input', 'enterprise-input')
      name.value = item.label
      name.oninput = () => { items = replace(items, index, { ...items[index]!, label: name.value }) }
      const role = el('input', 'enterprise-input enterprise-role-input')
      role.placeholder = 'roles: owner, admin'
      role.value = item.requiredRoles?.join(', ') ?? ''
      role.oninput = () => {
        const roles = role.value.split(',').map(value => value.trim()).filter(Boolean)
        items = replace(items, index, { ...items[index]!, requiredRoles: roles.length ? roles : undefined } as DesktopNavigationItem)
      }
      main.append(name, role)

      const controls = el('div', 'enterprise-editor-controls')
      const up = text(el('button'), '↑') as HTMLButtonElement
      const down = text(el('button'), '↓') as HTMLButtonElement
      up.type = down.type = 'button'
      up.disabled = index === 0
      down.disabled = index === items.length - 1
      up.onclick = () => {
        if (index === 0) return
        const next = [...items]
        const [moved] = next.splice(index, 1)
        if (moved) next.splice(index - 1, 0, moved)
        items = next
        draw()
      }
      down.onclick = () => {
        if (index === items.length - 1) return
        const next = [...items]
        const [moved] = next.splice(index, 1)
        if (moved) next.splice(index + 1, 0, moved)
        items = next
        draw()
      }
      controls.append(up, down)
      row.append(main, controls)
      list.append(row)
    })
  }
  draw()
  sheet.append(text(el('h3', 'enterprise-editor-title'), 'Navigation'), list)

  const save = text(el('button', 'enterprise-primary-button'), 'Publish enterprise layout') as HTMLButtonElement
  save.type = 'button'
  save.onclick = () => {
    draft.navigation = items.map((item, index) => ({ ...item, order: (index + 1) * 10 }))
    draft.homeRoute = draft.navigation.some(item => item.route === draft.homeRoute)
      ? draft.homeRoute
      : draft.navigation[0]?.route ?? '/tasks/new'
    save.disabled = true
    void window.dshEnterprise.saveWorkspaceDefinition('enterprise-shell-main', draft).then(async () => {
      await input.onSaved()
      backdrop.remove()
    }).finally(() => { save.disabled = false })
  }
  sheet.append(save)
  backdrop.append(sheet)
  document.body.append(backdrop)
}

export async function mountDesktopEnterpriseShell(root: HTMLElement, mountProduct: ProductMount): Promise<ProductUnmount> {
  root.replaceChildren()
  root.dataset.enterpriseShell = 'true'

  const context = await window.dshEnterprise.context()
  let workspace = await window.dshEnterprise.workspace()
  let tenant = selectedTenant(context)
  let productUnmount: ProductUnmount | undefined
  let productMounted = false
  let currentItem = workspace.navigation.find(item => item.route === workspace.homeRoute) ?? workspace.navigation[0]

  const shell = el('main', 'enterprise-desktop-shell')
  const rail = el('aside', 'enterprise-app-rail')
  const contextHost = el('aside', 'enterprise-context-pane')
  const stage = el('section', 'enterprise-stage')
  const scopebar = el('header', 'enterprise-scopebar')
  const outlet = el('div', 'enterprise-outlet')
  const productHost = el('div', 'enterprise-product-host')
  productHost.hidden = true
  outlet.append(productHost)
  stage.append(scopebar, outlet)
  shell.append(rail, contextHost, stage)
  root.append(shell)

  const currentScope = (): { environmentId?: string; projectId?: string } => {
    const projectId = workspace.preferences.defaultProjectId ?? tenant.projects[0]?.id
    const environmentId = workspace.preferences.defaultEnvironmentId
      ?? tenant.environments.find(item => item.kind === 'production' && item.status === 'active')?.id
      ?? tenant.environments.find(item => item.status === 'active')?.id
    return {
      ...(projectId ? { projectId } : {}),
      ...(environmentId ? { environmentId } : {}),
    }
  }

  const requiredScope = (): { projectId: string; environmentId: string } => {
    const scope = currentScope()
    if (!scope.projectId || !scope.environmentId) {
      throw new Error('Enterprise Desktop requires an OBIS project and active environment before AI Runtime can start.')
    }
    return { projectId: scope.projectId, environmentId: scope.environmentId }
  }

  const establishRuntimeScope = async (scope = requiredScope()): Promise<void> => {
    await window.dshEnterprise.validateRuntimeScope(scope)
    await window.dshDesktop.restartRuntime()
  }

  const showRoute = async (item: DesktopNavigationItem): Promise<void> => {
    currentItem = item
    for (const button of rail.querySelectorAll<HTMLButtonElement>('[data-nav-id]')) {
      button.classList.toggle('is-active', button.dataset.navId === item.id)
    }

    if (item.kind === 'new-task') {
      for (const child of [...outlet.children]) if (child !== productHost) child.remove()
      productHost.hidden = false
      if (!productMounted) {
        productMounted = true
        productUnmount = await mountProduct(productHost)
      }
      return
    }

    productHost.hidden = true
    for (const child of [...outlet.children]) if (child !== productHost) child.remove()
    const page = el('div', 'enterprise-native-page')
    outlet.append(page)

    if (item.kind === 'operations') {
      const scope = currentScope()
      if (!scope.environmentId) {
        renderEmptyOutlet(page, 'Operations', 'This tenant does not expose an environment that can be used for governed operations.')
        return
      }
      await renderEnterpriseControlCenter(page, { environmentId: scope.environmentId, ...(scope.projectId ? { projectId: scope.projectId } : {}) })
      return
    }

    if (item.kind === 'team') renderEmptyOutlet(page, 'Team', 'The shell is ready for the OBIS organization directory surface. Team data will be loaded from governed identity and organization sources rather than bundled into the client.')
    else if (item.kind === 'assistants') renderEmptyOutlet(page, 'Assistant plaza', 'Enterprise assistants can be published by administrators and targeted by role, team or user. The Desktop shell provides the marketplace surface without granting new tool authority.')
    else if (item.kind === 'skills') renderEmptyOutlet(page, 'Experts · Skills · Plugins', 'Installed Skills and MCP capabilities remain runtime-governed. This surface can be customized by enterprise policy and module bindings.')
    else if (item.kind === 'automation') renderEmptyOutlet(page, 'Automation', 'Automations and scheduled enterprise work are presented here while execution remains governed by OBIS.')
    else if (item.kind === 'knowledge') renderEmptyOutlet(page, 'Knowledge', 'Enterprise knowledge, document ingestion and semantic search are resolved through OBIS rather than local Desktop-only state.')
    else renderEmptyOutlet(page, item.label, item.moduleId ? `This surface is declared by module ${item.moduleId}.` : 'This enterprise surface is defined by the tenant Desktop workspace contract.')
  }

  const renderScope = (): void => {
    scopebar.replaceChildren()

    const tenantSelect = el('select', 'enterprise-scope-select')
    for (const value of context.tenants) {
      const option = el('option')
      option.value = value.id
      option.textContent = value.displayName
      option.selected = value.id === context.currentTenantId
      tenantSelect.append(option)
    }
    tenantSelect.onchange = () => {
      tenantSelect.disabled = true
      void window.dshEnterprise.switchTenant(tenantSelect.value).then(() =>{  window.location.reload() }).catch(() => { tenantSelect.disabled = false })
    }

    const scope = currentScope()
    const project = el('select', 'enterprise-scope-select')
    const projectEmpty = el('option')
    projectEmpty.value = ''
    projectEmpty.textContent = 'Project'
    project.append(projectEmpty)
    for (const value of tenant.projects) {
      const option = el('option')
      option.value = value.id
      option.textContent = value.name
      option.selected = value.id === scope.projectId
      project.append(option)
    }

    const environment = el('select', 'enterprise-scope-select')
    for (const value of tenant.environments) {
      const option = el('option')
      option.value = value.id
      option.textContent = value.name
      option.selected = value.id === scope.environmentId
      environment.append(option)
    }

    const saveScope = async (): Promise<void> => {
      if (!project.value || !environment.value) {
        throw new Error('Project and environment are required for Enterprise Runtime scope.')
      }
      project.disabled = true
      environment.disabled = true
      try {
        const nextScope = { projectId: project.value, environmentId: environment.value }
        await window.dshEnterprise.validateRuntimeScope(nextScope)
        workspace.preferences = await window.dshEnterprise.savePreferences({
          pinnedIds: workspace.preferences.pinnedIds,
          hiddenOptionalIds: workspace.preferences.hiddenOptionalIds,
          navigationOrder: workspace.preferences.navigationOrder,
          defaultProjectId: nextScope.projectId,
          defaultEnvironmentId: nextScope.environmentId,
        })
        await window.dshDesktop.restartRuntime()
        if (currentItem?.kind === 'operations') await showRoute(currentItem)
        renderRail()
      } finally {
        project.disabled = false
        environment.disabled = false
      }
    }
    const saveScopeSafely = (): void => {
      void saveScope().catch(error => {
        console.error('[enterprise-scope] failed to switch runtime scope:', error)
        renderScope()
      })
    }
    project.onchange = saveScopeSafely
    environment.onchange = saveScopeSafely

    const spacer = el('div', 'enterprise-scope-spacer')
    const manage = text(el('button', 'enterprise-secondary-button'), workspace.customization.canManageEnterprise ? 'Manage layout' : 'Customize') as HTMLButtonElement
    manage.type = 'button'
    manage.onclick = () => {
      if (workspace.customization.canManageEnterprise) {
        openAdminEditor({
          workspace,
          onSaved: async () => {
            workspace = await window.dshEnterprise.workspace()
            tenant = selectedTenant(context)
            renderAll()
          },
        })
      } else {
        openPreferenceEditor({
          workspace,
          onSave: async (next) => {
            workspace = { ...workspace, preferences: next }
            workspace = await window.dshEnterprise.workspace()
            renderAll()
          },
        })
      }
    }
    scopebar.append(tenantSelect, project, environment, spacer, manage)
  }

  const renderRail = (): void => {
    rail.replaceChildren()
    const brand = el('div', 'enterprise-brand')
    const brandText = el('div')
    brandText.append(text(el('strong'), workspace.branding.productName), text(el('span'), tenant.displayName))
    brand.append(text(el('span', 'enterprise-brand-mark'), workspace.branding.productName.slice(0, 1).toUpperCase()), brandText)
    rail.append(brand)

    const nav = el('nav', 'enterprise-nav')
    for (const item of workspace.navigation) {
      const button = el('button', 'enterprise-nav-item')
      button.type = 'button'
      button.dataset.navId = item.id
      button.classList.toggle('is-active', item.id === currentItem?.id)
      button.append(text(el('span', 'enterprise-nav-icon'), icon(item.icon ?? item.kind)), text(el('span'), item.label))
      button.onclick = () => { void showRoute(item) }
      nav.append(button)
    }
    rail.append(nav)

    const footer = el('footer', 'enterprise-user-footer')
    const meta = el('div')
    const scope = currentScope()
    const environmentName = tenant.environments.find(item => item.id === scope.environmentId)?.name ?? scope.environmentId ?? 'environment'
    meta.append(text(el('strong'), context.user.displayName), text(el('span'), `${tenant.displayName} · ${environmentName}`))
    const settings = text(el('button', 'enterprise-icon-button'), '⋯') as HTMLButtonElement
    settings.type = 'button'
    settings.title = 'Personalize workspace'
    settings.onclick = () =>{  openPreferenceEditor({
      workspace,
      onSave: async (next) => {
        workspace = { ...workspace, preferences: next }
        workspace = await window.dshEnterprise.workspace()
        renderAll()
      },
    }) }
    footer.append(text(el('span', 'enterprise-user-avatar'), context.user.displayName.slice(0, 1).toUpperCase()), meta, settings)
    rail.append(footer)
  }

  const renderAll = (): void => {
    contextHost.hidden = workspace.contextPane.mode === 'none'
    shell.classList.toggle('context-hidden', workspace.contextPane.mode === 'none')
    renderRail()
    renderContextPane(contextHost, workspace, tenant)
    renderScope()
    if (currentItem && !workspace.navigation.some(item => item.id === currentItem?.id)) {
      currentItem = workspace.navigation.find(item => item.route === workspace.homeRoute) ?? workspace.navigation[0]
    }
    if (currentItem) void showRoute(currentItem)
  }

  await establishRuntimeScope()
  renderAll()
  return () => {
    productUnmount?.()
    delete root.dataset.enterpriseShell
    root.replaceChildren()
  }
}
