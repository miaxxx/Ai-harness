import type {
  DesktopApprovalSummary,
  DesktopEnterpriseOverview,
  DesktopEnvironmentRuntimeState,
  DesktopMaintenanceTaskType,
  DesktopModelBudgetState,
  DesktopModelUsageRecord,
  DesktopOperationsSnapshot,
  DesktopOverviewSection,
  DesktopWorkloadKind,
} from './desktop-obis-identity-shared.ts'
import { renderIdentityGovernance } from './desktop-enterprise-identity-ui.ts'
import './desktop-enterprise-overview.css'

const WORKLOADS: readonly DesktopWorkloadKind[] = ['action', 'model', 'mcp', 'workflow', 'task', 'sync', 'agent']
const MAINTENANCE_TYPES: readonly DesktopMaintenanceTaskType[] = ['reconcile', 'cleanup', 'compact', 'update']

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function text(node: HTMLElement, value: string): HTMLElement {
  node.textContent = value
  return node
}

function money(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2 }).format(value)
}

function integer(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function timestamp(value?: string): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value
}

function stateLabel(state: DesktopEnvironmentRuntimeState): string {
  return state === 'active' ? 'Active' : state === 'draining' ? 'Draining' : state === 'maintenance' ? 'Maintenance' : 'Disabled'
}

function sectionUnavailable<T>(host: HTMLElement, section: DesktopOverviewSection<T>, title: string): boolean {
  if (section.available) return false
  const card = el('section', 'enterprise-control-panel enterprise-control-panel-unavailable')
  const header = el('div', 'enterprise-control-panel-head')
  header.append(text(el('h2'), title), text(el('span', 'enterprise-control-status'), section.status === 403 ? 'Restricted' : 'Unavailable'))
  const copy = section.status === 403
    ? 'Your current OBIS role does not include read authority for this enterprise control surface.'
    : section.error
  card.append(header, text(el('p', 'enterprise-control-muted'), copy))
  host.append(card)
  return true
}

function metric(label: string, value: string, detail?: string, tone?: string): HTMLElement {
  const card = el('article', 'enterprise-control-metric')
  if (tone) card.dataset.tone = tone
  card.append(text(el('span', 'enterprise-control-kicker'), label), text(el('strong'), value))
  if (detail) card.append(text(el('small'), detail))
  return card
}

function actionButton(label: string, tone: 'primary' | 'danger' | 'quiet' = 'quiet'): HTMLButtonElement {
  const button = text(el('button', `enterprise-control-action is-${tone}`), label) as HTMLButtonElement
  button.type = 'button'
  return button
}

async function executeAction(button: HTMLButtonElement, operation: () => Promise<void>): Promise<void> {
  if (button.disabled) return
  button.disabled = true
  const previous = button.textContent
  button.textContent = 'Working…'
  try {
    await operation()
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error))
  } finally {
    button.disabled = false
    button.textContent = previous
  }
}

function operationsMetrics(snapshot: DesktopOperationsSnapshot): HTMLElement[] {
  const activeKinds = WORKLOADS.filter(kind => (snapshot.usage.active[kind] ?? 0) > 0)
  const rateKinds = WORKLOADS.filter(kind => (snapshot.usage.startsThisMinute[kind] ?? 0) > 0)
  return [
    metric('ENVIRONMENT', stateLabel(snapshot.state.state), snapshot.state.reason ?? `State version ${snapshot.state.version}`, snapshot.state.state),
    metric('ACTIVE WORKLOADS', integer(snapshot.usage.activeTotal), activeKinds.length ? activeKinds.map(kind => `${kind} ${snapshot.usage.active[kind]}`).join(' · ') : 'No active governed workloads'),
    metric('STARTS THIS MINUTE', integer(Object.values(snapshot.usage.startsThisMinute).reduce((sum, value) => sum + (value ?? 0), 0)), rateKinds.length ? rateKinds.map(kind => `${kind} ${snapshot.usage.startsThisMinute[kind]}`).join(' · ') : snapshot.usage.minuteBucket),
    metric('MAINTENANCE', integer(snapshot.maintenance.filter(item => item.status === 'queued' || item.status === 'running').length), `${snapshot.maintenance.length} recent task${snapshot.maintenance.length === 1 ? '' : 's'}`),
  ]
}

function approvalMetric(overview: DesktopEnterpriseOverview): HTMLElement {
  if (!overview.approvals.available) return metric('WAITING FOR ME', '—', overview.approvals.status === 403 ? 'Role restricted' : 'Approval inbox unavailable')
  const inbox = overview.approvals.value
  return metric('WAITING FOR ME', integer(inbox.waitingForMe.length), `${inbox.escalated.length} escalated · ${inbox.requestedByMe.length} requested by me`, inbox.waitingForMe.length ? 'attention' : undefined)
}

function budgetMetric(overview: DesktopEnterpriseOverview): HTMLElement {
  if (!overview.modelBudget.available) return metric('MODEL SPEND', '—', overview.modelBudget.status === 403 ? 'Role restricted' : 'Budget summary unavailable')
  const states = overview.modelBudget.value.items
  const spent = states.reduce((sum, item) => sum + item.monthly.costUsd, 0)
  const limit = states.reduce((sum, item) => sum + item.policy.monthlyBudgetUsd, 0)
  return metric('MODEL SPEND', money(spent), limit > 0 ? `${money(limit)} configured monthly budget` : 'No active budget policy', states.some(item => item.warning) ? 'attention' : undefined)
}

function allowedTransitions(state: DesktopEnvironmentRuntimeState): DesktopEnvironmentRuntimeState[] {
  if (state === 'active') return ['draining', 'disabled']
  if (state === 'draining') return ['active', 'maintenance', 'disabled']
  if (state === 'maintenance') return ['active', 'disabled']
  return ['active']
}

function renderOperations(host: HTMLElement, snapshot: DesktopOperationsSnapshot, refresh: () => Promise<void>): void {
  const panel = el('section', 'enterprise-control-panel')
  const head = el('div', 'enterprise-control-panel-head')
  head.append(text(el('h2'), 'Operations'))
  const headRight = el('div', 'enterprise-control-head-actions')
  headRight.append(text(el('span', 'enterprise-control-status'), `Updated ${timestamp(snapshot.usage.updatedAt)}`))
  const transitions = el('div', 'enterprise-control-actions')
  for (const next of allowedTransitions(snapshot.state.state)) {
    const button = actionButton(next === 'active' ? 'Activate' : next === 'draining' ? 'Drain' : next === 'maintenance' ? 'Enter maintenance' : 'Disable', next === 'disabled' ? 'danger' : next === 'active' ? 'primary' : 'quiet')
    button.addEventListener('click', () => void executeAction(button, async () => {
      const promptValue = window.prompt(`Reason for transition to ${next} (optional)`, snapshot.state.reason ?? '')
      if (promptValue === null) return
      await window.dshEnterprise.transitionEnvironment({ environmentId: snapshot.state.environmentId, to: next, ...(promptValue.trim() ? { reason: promptValue.trim() } : {}) })
      await refresh()
    }))
    transitions.append(button)
  }
  headRight.append(transitions)
  head.append(headRight)
  panel.append(head)

  const grid = el('div', 'enterprise-control-two-column')
  const quota = el('div', 'enterprise-control-subpanel')
  quota.append(text(el('h3'), 'Admission quota'))
  const table = el('div', 'enterprise-control-table')
  for (const kind of WORKLOADS) {
    const row = el('div', 'enterprise-control-table-row')
    row.append(
      text(el('span'), kind),
      text(el('span'), snapshot.quota.maxConcurrent[kind] === undefined ? 'Concurrent —' : `Concurrent ${snapshot.quota.maxConcurrent[kind]}`),
      text(el('span'), snapshot.quota.startsPerMinute[kind] === undefined ? 'Rate —' : `${snapshot.quota.startsPerMinute[kind]}/min`),
    )
    table.append(row)
  }
  quota.append(table)

  const maintenance = el('div', 'enterprise-control-subpanel')
  const maintenanceHead = el('div', 'enterprise-control-subpanel-head')
  maintenanceHead.append(text(el('h3'), 'Maintenance'))
  if (snapshot.state.state === 'maintenance') {
    const controls = el('div', 'enterprise-control-actions')
    for (const type of MAINTENANCE_TYPES) {
      const button = actionButton(type, 'quiet')
      button.addEventListener('click', () => void executeAction(button, async () => {
        const reason = window.prompt(`Reason for ${type} maintenance (optional)`, '')
        if (reason === null) return
        await window.dshEnterprise.requestMaintenance({ environmentId: snapshot.state.environmentId, type, ...(reason.trim() ? { reason: reason.trim() } : {}) })
        await refresh()
      }))
      controls.append(button)
    }
    maintenanceHead.append(controls)
  }
  maintenance.append(maintenanceHead)
  if (!snapshot.maintenance.length) {
    maintenance.append(text(el('p', 'enterprise-control-muted'), snapshot.state.state === 'maintenance' ? 'No maintenance tasks have been recorded for this environment.' : 'Enter maintenance mode after the environment is drained to schedule governed maintenance.'))
  } else {
    for (const task of snapshot.maintenance.slice(0, 8)) {
      const row = el('div', 'enterprise-control-list-row')
      const main = el('div')
      main.append(text(el('strong'), task.type), text(el('small'), task.reason ?? `Requested by ${task.requestedBy}`))
      const meta = el('div', 'enterprise-control-list-meta')
      meta.append(text(el('span', `enterprise-control-pill is-${task.status}`), task.status), text(el('small'), timestamp(task.createdAt)))
      row.append(main, meta)
      maintenance.append(row)
    }
  }
  grid.append(quota, maintenance)
  panel.append(grid)
  host.append(panel)
}

function approvalTitle(value: DesktopApprovalSummary): string {
  const gate = value.gate || 'approval'
  const action = value.action || value.id
  return `${gate} · ${action}`
}

function renderApprovals(host: HTMLElement, overview: DesktopEnterpriseOverview, refresh: () => Promise<void>): void {
  if (sectionUnavailable(host, overview.approvals, 'Approval inbox')) return
  const inbox = overview.approvals.value
  const panel = el('section', 'enterprise-control-panel')
  const head = el('div', 'enterprise-control-panel-head')
  head.append(text(el('h2'), 'Approval inbox'), text(el('span', 'enterprise-control-status'), `${inbox.waitingForMe.length} waiting`))
  panel.append(head)
  if (!inbox.waitingForMe.length) {
    panel.append(text(el('p', 'enterprise-control-muted'), 'Nothing is currently waiting for your approval in this environment.'))
  } else {
    for (const approval of inbox.waitingForMe.slice(0, 8)) {
      const row = el('div', 'enterprise-control-list-row enterprise-control-approval-row')
      const main = el('div')
      main.append(
        text(el('strong'), approvalTitle(approval)),
        text(el('small'), `${approval.currentStage.name ?? approval.currentStage.id} · ${approval.currentStage.approvals}/${approval.currentStage.quorum} approvals · version ${approval.version}`),
      )
      const meta = el('div', 'enterprise-control-list-meta')
      if ((approval.escalationCount ?? 0) > 0) meta.append(text(el('span', 'enterprise-control-pill is-attention'), 'escalated'))
      meta.append(text(el('small'), timestamp(approval.createdAt)))
      const controls = el('div', 'enterprise-control-actions')
      const reject = actionButton('Reject', 'danger')
      reject.addEventListener('click', () => void executeAction(reject, async () => {
        const comment = window.prompt('Rejection reason (optional)', '')
        if (comment === null) return
        await window.dshEnterprise.decideApproval({ approvalId: approval.id, environmentId: approval.environmentId, expectedVersion: approval.version, decision: 'reject', ...(comment.trim() ? { comment: comment.trim() } : {}) })
        await refresh()
      }))
      const approve = actionButton('Approve', 'primary')
      approve.addEventListener('click', () => void executeAction(approve, async () => {
        if (!window.confirm(`Approve ${approvalTitle(approval)}?`)) return
        await window.dshEnterprise.decideApproval({ approvalId: approval.id, environmentId: approval.environmentId, expectedVersion: approval.version, decision: 'approve' })
        await refresh()
      }))
      controls.append(reject, approve)
      meta.append(controls)
      row.append(main, meta)
      panel.append(row)
    }
  }
  host.append(panel)
}

function budgetLabel(state: DesktopModelBudgetState): string {
  return state.policy.projectId ? `Project ${state.policy.projectId}` : 'Environment budget'
}

function renderModelGovernance(host: HTMLElement, overview: DesktopEnterpriseOverview): void {
  const panel = el('section', 'enterprise-control-panel')
  const head = el('div', 'enterprise-control-panel-head')
  head.append(text(el('h2'), 'Model governance'), text(el('span', 'enterprise-control-status'), 'Budget & recent usage'))
  panel.append(head)

  if (!overview.modelBudget.available && !overview.modelUsage.available) {
    const status = overview.modelBudget.status ?? overview.modelUsage.status
    panel.append(text(el('p', 'enterprise-control-muted'), status === 403 ? 'Your current OBIS role does not include model governance read authority.' : 'Model governance data is currently unavailable.'))
    host.append(panel)
    return
  }

  if (overview.modelBudget.available) {
    const budgets = el('div', 'enterprise-control-budget-grid')
    if (!overview.modelBudget.value.items.length) {
      budgets.append(text(el('p', 'enterprise-control-muted'), 'No enabled model budget policy is configured for this scope.'))
    }
    for (const state of overview.modelBudget.value.items) {
      const card = el('article', 'enterprise-control-budget')
      if (state.warning) card.dataset.warning = 'true'
      const percent = state.policy.monthlyBudgetUsd > 0 ? Math.min(100, state.monthly.costUsd / state.policy.monthlyBudgetUsd * 100) : 0
      card.append(
        text(el('span', 'enterprise-control-kicker'), budgetLabel(state)),
        text(el('strong'), `${money(state.monthly.costUsd)} / ${money(state.policy.monthlyBudgetUsd)}`),
        text(el('small'), `${percent.toFixed(1)}% used · ${money(state.remainingUsd)} remaining · ${integer(state.monthly.inputTokens + state.monthly.outputTokens)} tokens`),
      )
      const progress = el('div', 'enterprise-control-progress')
      const fill = el('span')
      fill.style.width = `${percent}%`
      progress.append(fill)
      card.append(progress)
      budgets.append(card)
    }
    panel.append(budgets)
  }

  if (overview.modelUsage.available) {
    const title = text(el('h3', 'enterprise-control-section-title'), 'Recent model requests')
    panel.append(title)
    if (!overview.modelUsage.value.length) {
      panel.append(text(el('p', 'enterprise-control-muted'), 'No model requests have been recorded for this scope.'))
    }
    for (const usage of overview.modelUsage.value.slice(0, 10)) renderUsage(panel, usage)
  }
  host.append(panel)
}

function renderUsage(host: HTMLElement, usage: DesktopModelUsageRecord): void {
  const row = el('div', 'enterprise-control-list-row')
  const main = el('div')
  main.append(
    text(el('strong'), `${usage.modelId} · ${usage.routeId}`),
    text(el('small'), `${integer(usage.inputTokens)} in / ${integer(usage.outputTokens)} out · ${usage.durationMs} ms`),
  )
  const meta = el('div', 'enterprise-control-list-meta')
  meta.append(text(el('span', `enterprise-control-pill is-${usage.status}`), usage.status), text(el('strong'), money(usage.costUsd)), text(el('small'), timestamp(usage.createdAt)))
  row.append(main, meta)
  host.append(row)
}

export async function renderEnterpriseControlCenter(host: HTMLElement, scope: { environmentId: string; projectId?: string }): Promise<void> {
  host.replaceChildren()
  const loading = el('section', 'enterprise-control-loading')
  loading.append(text(el('span', 'enterprise-control-kicker'), 'OBIS ENTERPRISE'), text(el('h1'), 'Loading governed environment…'))
  host.append(loading)

  let overview: DesktopEnterpriseOverview
  try {
    overview = await window.dshEnterprise.overview(scope)
  } catch (error) {
    host.replaceChildren()
    const failure = el('section', 'enterprise-control-loading')
    failure.append(
      text(el('span', 'enterprise-control-kicker'), 'OBIS ENTERPRISE'),
      text(el('h1'), 'Enterprise controls unavailable'),
      text(el('p', 'enterprise-control-muted'), error instanceof Error ? error.message : String(error)),
    )
    host.append(failure)
    return
  }

  host.replaceChildren()
  const page = el('div', 'enterprise-control-page')
  const header = el('header', 'enterprise-control-page-head')
  const title = el('div')
  title.append(text(el('span', 'enterprise-control-kicker'), 'ENTERPRISE CONTROL CENTER'), text(el('h1'), 'Operations & governance'))
  const scopeMeta = el('div', 'enterprise-control-scope')
  scopeMeta.append(text(el('strong'), overview.environmentId))
  if (overview.projectId) scopeMeta.append(text(el('span'), overview.projectId))
  scopeMeta.append(text(el('small'), `Fetched ${timestamp(overview.fetchedAt)}`))
  header.append(title, scopeMeta)
  page.append(header)

  const metrics = el('section', 'enterprise-control-metrics')
  if (overview.operations.available) {
    for (const item of operationsMetrics(overview.operations.value)) metrics.append(item)
  } else {
    metrics.append(metric('ENVIRONMENT', '—', overview.operations.status === 403 ? 'Operations read restricted' : 'Operations unavailable'))
    metrics.append(metric('ACTIVE WORKLOADS', '—', 'No governed snapshot'))
  }
  metrics.append(approvalMetric(overview), budgetMetric(overview))
  page.append(metrics)

  const refresh = () => renderEnterpriseControlCenter(host, scope)
  if (overview.operations.available) renderOperations(page, overview.operations.value, refresh)
  else sectionUnavailable(page, overview.operations, 'Operations')
  renderApprovals(page, overview, refresh)
  renderIdentityGovernance(page, overview.identity)
  renderModelGovernance(page, overview)
  host.append(page)
}
