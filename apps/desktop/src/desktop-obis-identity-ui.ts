import type { DesktopObisIdentityStatus } from './desktop-obis-identity-shared.ts'
import './desktop-obis-identity.css'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', 'obis-enterprise-button')
  node.type = 'button'
  node.textContent = label
  node.addEventListener('click', onClick)
  return node
}

function setMessage(node: HTMLElement, message: string, kind: 'info' | 'error' = 'info'): void {
  node.textContent = message
  node.dataset.kind = kind
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:[\w$]+Error: )?/, '')
}

function renderShell(root: HTMLElement, title: string, description: string): { card: HTMLElement; message: HTMLElement } {
  root.replaceChildren()
  const shell = element('main', 'obis-enterprise-gate')
  const card = element('section', 'obis-enterprise-card')
  const eyebrow = element('div', 'obis-enterprise-eyebrow')
  eyebrow.textContent = 'OBIS ENTERPRISE'
  const heading = element('h1')
  heading.textContent = title
  const copy = element('p')
  copy.textContent = description
  const message = element('p', 'obis-enterprise-message')
  card.append(eyebrow, heading, copy, message)
  shell.append(card)
  root.append(shell)
  return { card, message }
}

function configurationGate(root: HTMLElement): void {
  const { card, message } = renderShell(root, 'Connect this desktop to OBIS', 'Enterprise mode requires a governed OBIS authority. Credentials are persisted only after authentication and protected by the operating-system secure storage used by Orbis AI.')
  const form = element('div', 'obis-enterprise-fields')
  const urlLabel = element('label'); urlLabel.textContent = 'OBIS URL'
  const url = element('input'); url.type = 'url'; url.placeholder = 'https://obis.example.com'
  const tenantLabel = element('label'); tenantLabel.textContent = 'Tenant'
  const tenant = element('input'); tenant.placeholder = 'acme'
  urlLabel.append(url); tenantLabel.append(tenant); form.append(urlLabel, tenantLabel)
  const save = button('Connect to OBIS', () => {
    save.disabled = true
    setMessage(message, 'Validating enterprise authority…')
    void window.dshEnterprise.configure({ baseURL: url.value, tenantId: tenant.value })
      .then(() => identityGate(root))
      .catch((error: unknown) => { setMessage(message, publicError(error), 'error'); save.disabled = false })
  })
  card.append(form, save)
}

function loginView(root: HTMLElement, status: DesktopObisIdentityStatus): void {
  const { card, message } = renderShell(root, 'Sign in to your enterprise workspace', `This desktop is governed by ${status.baseURL ?? 'OBIS'} for tenant ${status.tenantId ?? 'unknown'}. AI Harness can reason locally, but enterprise context and execution remain controlled by OBIS.`)
  const form = element('div', 'obis-enterprise-fields')
  const emailLabel = element('label'); emailLabel.textContent = 'Email'
  const email = element('input'); email.type = 'email'; email.autocomplete = 'username'; email.placeholder = 'name@example.com'
  const passwordLabel = element('label'); passwordLabel.textContent = 'Password'
  const password = element('input'); password.type = 'password'; password.autocomplete = 'current-password'
  emailLabel.append(email); passwordLabel.append(password); form.append(emailLabel, passwordLabel)
  const signIn = button('Sign in', () => {
    signIn.disabled = true
    setMessage(message, 'Signing in…')
    void window.dshEnterprise.signInWithPassword({ email: email.value, password: password.value })
      .then(async () => {
        password.value = ''
        setMessage(message, 'Authenticated. Opening the governed AI Workspace…')
        await identityGate(root)
      })
      .catch((error: unknown) => { password.value = ''; setMessage(message, publicError(error), 'error'); signIn.disabled = false })
  })
  card.append(form, signIn)
}

function installIdentityBadge(status: DesktopObisIdentityStatus): void {
  document.getElementById('obis-enterprise-identity')?.remove()
  if (document.querySelector('[data-enterprise-shell="true"]')) return
  const badge = element('div', 'obis-enterprise-identity')
  badge.id = 'obis-enterprise-identity'
  const identity = element('span')
  identity.textContent = `${status.user?.displayName ?? status.user?.id ?? 'OBIS user'} · ${status.tenantId ?? ''}`
  const logout = button('Sign out', () => { logout.disabled = true; void window.dshEnterprise.logout().finally(() => { window.location.reload() }) })
  badge.append(identity, logout)
  document.body.append(badge)
}

let productMounted = false
let productMount: (() => Promise<void>) | undefined

async function identityGate(root: HTMLElement): Promise<void> {
  let status: DesktopObisIdentityStatus
  try { status = await window.dshEnterprise.status() }
  catch (error: unknown) {
    const { card, message } = renderShell(root, 'OBIS session unavailable', 'The saved enterprise identity could not be validated.')
    setMessage(message, publicError(error), 'error')
    card.append(button('Retry', () => { void identityGate(root) }))
    return
  }
  if (!status.configured) {
    if (status.required) configurationGate(root)
    else if (!productMounted && productMount) { productMounted = true; await productMount() }
    return
  }
  if (!status.authenticated) { loginView(root, status); return }
  if (!productMounted && productMount) {
    productMounted = true
    try {
      root.replaceChildren()
      await productMount()
    } catch (error: unknown) {
      productMounted = false
      const { card, message } = renderShell(
        root,
        'Signed in',
        `This desktop is authenticated to ${status.baseURL ?? 'OBIS'} as ${status.user?.primaryEmail ?? status.user?.displayName ?? 'the signed-in user'}.`,
      )
      setMessage(message, publicError(error), 'error')
      card.append(button('Retry', () => { void identityGate(root) }))
    }
  }
  installIdentityBadge(status)
}

export async function mountDesktopEnterpriseIdentity(root: HTMLElement, mountProduct: () => Promise<void>): Promise<void> {
  productMount = mountProduct
  await identityGate(root)
}
