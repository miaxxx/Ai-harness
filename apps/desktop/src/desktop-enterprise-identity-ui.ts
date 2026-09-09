import type {
  DesktopDirectoryUser,
  DesktopIdentityGovernanceOverview,
  DesktopOverviewSection,
  DesktopScimProviderSummary,
  DesktopSsoProviderSummary,
} from './desktop-obis-identity-shared.ts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function text(node: HTMLElement, value: string): HTMLElement {
  node.textContent = value
  return node
}

function unavailable<T>(section: DesktopOverviewSection<T>): string | undefined {
  if (section.available) return undefined
  return section.status === 403 ? 'Restricted to OBIS owner/admin roles' : section.error
}

function statusPill(value: string): HTMLElement {
  return text(el('span', `enterprise-control-pill is-${value}`), value)
}

function userRow(value: DesktopDirectoryUser): HTMLElement {
  const row = el('div', 'enterprise-control-list-row')
  const main = el('div')
  main.append(
    text(el('strong'), value.user.displayName || value.user.primaryEmail),
    text(el('small'), value.user.primaryEmail),
  )
  const meta = el('div', 'enterprise-control-list-meta')
  meta.append(
    statusPill(value.membership.status),
    text(el('small'), value.membership.roles.length ? value.membership.roles.join(' · ') : 'No roles'),
  )
  row.append(main, meta)
  return row
}

function ssoRow(value: DesktopSsoProviderSummary): HTMLElement {
  const row = el('div', 'enterprise-control-list-row')
  const main = el('div')
  const domains = value.domainRules.length ? value.domainRules.join(', ') : 'No discovery domains'
  main.append(
    text(el('strong'), value.displayName),
    text(el('small'), `${value.protocol.toUpperCase()} · ${domains}`),
  )
  const meta = el('div', 'enterprise-control-list-meta')
  meta.append(
    statusPill(value.enabled ? 'active' : 'disabled'),
    text(el('small'), value.allowJitLinkByEmail ? 'JIT email linking enabled' : 'JIT email linking disabled'),
  )
  row.append(main, meta)
  return row
}

function scimRow(value: DesktopScimProviderSummary): HTMLElement {
  const row = el('div', 'enterprise-control-list-row')
  const main = el('div')
  const mappings = Object.keys(value.groupRoleMappings).length
  main.append(
    text(el('strong'), value.displayName),
    text(el('small'), `${mappings} group-role mapping${mappings === 1 ? '' : 's'} · default roles ${value.defaultRoles.join(', ') || 'none'}`),
  )
  const meta = el('div', 'enterprise-control-list-meta')
  meta.append(statusPill(value.enabled ? 'active' : 'disabled'))
  row.append(main, meta)
  return row
}

function renderCollection<T>(input: {
  title: string
  section: DesktopOverviewSection<T[]>
  empty: string
  row: (value: T) => HTMLElement
}): HTMLElement {
  const block = el('div', 'enterprise-control-subpanel')
  const head = el('div', 'enterprise-control-subpanel-head')
  head.append(text(el('h3'), input.title))
  if (input.section.available) head.append(text(el('span', 'enterprise-control-status'), `${input.section.value.length}`))
  block.append(head)

  const error = unavailable(input.section)
  if (error) {
    block.append(text(el('p', 'enterprise-control-muted'), error))
    return block
  }
  if (!input.section.available) return block
  if (!input.section.value.length) {
    block.append(text(el('p', 'enterprise-control-muted'), input.empty))
    return block
  }
  for (const value of input.section.value.slice(0, 8)) block.append(input.row(value))
  return block
}

/**
 * Renderer receives deliberately sanitized summaries only. In particular SCIM secretRef,
 * SAML certificateSecretRef, bearer tokens and provider credentials never cross IPC.
 */
export function renderIdentityGovernance(host: HTMLElement, identity: DesktopIdentityGovernanceOverview): void {
  const panel = el('section', 'enterprise-control-panel')
  const head = el('div', 'enterprise-control-panel-head')
  head.append(
    text(el('h2'), 'Identity & provisioning'),
    text(el('span', 'enterprise-control-status'), 'Directory · SSO · SCIM'),
  )
  panel.append(head)

  const grid = el('div', 'enterprise-control-two-column')
  grid.append(
    renderCollection({
      title: 'Directory',
      section: identity.users,
      empty: 'No tenant users are provisioned.',
      row: userRow,
    }),
    renderCollection({
      title: 'Single sign-on',
      section: identity.ssoProviders,
      empty: 'No enterprise SSO provider is configured.',
      row: ssoRow,
    }),
  )
  panel.append(grid)
  panel.append(renderCollection({
    title: 'SCIM provisioning',
    section: identity.scimProviders,
    empty: 'No SCIM provisioning provider is configured.',
    row: scimRow,
  }))
  host.append(panel)
}
