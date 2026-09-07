import type {
  DesktopObisDeviceAuthorization,
  DesktopObisIdentityStatus,
} from './desktop-obis-identity-shared.ts'
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
  return error instanceof Error ? error.message : String(error)
}

function renderShell(root: HTMLElement, title: string, description: string): {
  card: HTMLElement
  message: HTMLElement
} {
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

async function configurationGate(root: HTMLElement): Promise<void> {
  const { card, message } = renderShell(
    root,
    'Connect this desktop to OBIS',
    'Enterprise mode requires a governed OBIS authority. Credentials will be stored only after authentication and encrypted by the macOS secure storage used by Orbis AI.',
  )
  const form = element('div', 'obis-enterprise-fields')
  const urlLabel = element('label')
  urlLabel.textContent = 'OBIS URL'
  const url = element('input')
  url.type = 'url'
  url.placeholder = 'https://obis.example.com'
  const tenantLabel = element('label')
  tenantLabel.textContent = 'Tenant'
  const tenant = element('input')
  tenant.placeholder = 'acme'
  urlLabel.append(url)
  tenantLabel.append(tenant)
  form.append(urlLabel, tenantLabel)
  const save = button('Connect to OBIS', () => {
    save.disabled = true
    setMessage(message, 'Validating enterprise authority…')
    void window.dshEnterprise.configure({ baseURL: url.value, tenantId: tenant.value })
      .then(() => identityGate(root))
      .catch((error: unknown) => {
        setMessage(message, publicError(error), 'error')
        save.disabled = false
      })
  })
  card.append(form, save)
}

function loginView(root: HTMLElement, status: DesktopObisIdentityStatus): void {
  const { card, message } = renderShell(
    root,
    'Sign in to your enterprise workspace',
    `This desktop is governed by ${status.baseURL ?? 'OBIS'} for tenant ${status.tenantId ?? 'unknown'}. AI Harness can reason locally, but enterprise context and execution remain controlled by OBIS.`,
  )
  let currentAuthorization: DesktopObisDeviceAuthorization | undefined
  let cancelled = false

  const code = element('div', 'obis-enterprise-code')
  const actions = element('div', 'obis-enterprise-actions')
  const signIn = button('Sign in with GitHub', () => {
    signIn.disabled = true
    setMessage(message, 'Requesting a one-time GitHub device authorization…')
    void window.dshEnterprise.startDeviceAuthorization().then(async (authorization) => {
      currentAuthorization = authorization
      code.textContent = authorization.userCode
      setMessage(message, 'Complete the authorization in your browser. This window will continue automatically.')
      await window.dshDesktop.openExternal(authorization.verificationUri)
      const deadline = Date.now() + authorization.expiresInSeconds * 1000
      let waitSeconds = Math.max(1, authorization.intervalSeconds)
      while (!cancelled && currentAuthorization === authorization && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000))
        if (cancelled || currentAuthorization !== authorization) return
        try {
          const result = await window.dshEnterprise.exchangeDeviceAuthorization(authorization.deviceCode)
          if (result.status === 'authenticated') {
            setMessage(message, 'Authenticated. Opening the governed AI Workspace…')
            await identityGate(root)
            return
          }
          if (result.status === 'slow_down') waitSeconds = Math.max(waitSeconds + 5, result.retryAfterSeconds ?? 0)
          else if (result.retryAfterSeconds !== undefined) waitSeconds = Math.max(waitSeconds, result.retryAfterSeconds)
        } catch (error: unknown) {
          currentAuthorization = undefined
          setMessage(message, publicError(error), 'error')
          signIn.disabled = false
          return
        }
      }
      if (!cancelled && currentAuthorization === authorization) {
        currentAuthorization = undefined
        setMessage(message, 'The one-time sign-in code expired. Start a new authorization.', 'error')
        signIn.disabled = false
      }
    }).catch((error: unknown) => {
      setMessage(message, publicError(error), 'error')
      signIn.disabled = false
    })
  })
  actions.append(signIn)
  card.append(code, actions)

  window.addEventListener('beforeunload', () => { cancelled = true }, { once: true })
}

function installIdentityBadge(status: DesktopObisIdentityStatus): void {
  document.getElementById('obis-enterprise-identity')?.remove()
  const badge = element('div', 'obis-enterprise-identity')
  badge.id = 'obis-enterprise-identity'
  const identity = element('span')
  identity.textContent = `${status.user?.displayName ?? status.user?.id ?? 'OBIS user'} · ${status.tenantId ?? ''}`
  const logout = button('Sign out', () => {
    logout.disabled = true
    void window.dshEnterprise.logout().finally(() => { window.location.reload() })
  })
  badge.append(identity, logout)
  document.body.append(badge)
}

let productMounted = false
let productMount: (() => Promise<void>) | undefined

async function identityGate(root: HTMLElement): Promise<void> {
  let status: DesktopObisIdentityStatus
  try {
    status = await window.dshEnterprise.status()
  } catch (error: unknown) {
    const { card, message } = renderShell(root, 'OBIS session unavailable', 'The saved enterprise identity could not be validated.')
    setMessage(message, publicError(error), 'error')
    card.append(button('Retry', () => { void identityGate(root) }))
    return
  }

  if (!status.configured) {
    if (status.required) await configurationGate(root)
    else if (!productMounted && productMount) {
      productMounted = true
      await productMount()
    }
    return
  }

  if (!status.authenticated) {
    loginView(root, status)
    return
  }

  if (!productMounted && productMount) {
    productMounted = true
    root.replaceChildren()
    await productMount()
  }
  installIdentityBadge(status)
}

/**
 * Mount the existing Desktop product behind an optional/required OBIS identity boundary.
 * Local-only Desktop behavior is unchanged when no OBIS authority is configured.
 */
export async function mountDesktopEnterpriseIdentity(root: HTMLElement, mountProduct: () => Promise<void>): Promise<void> {
  productMount = mountProduct
  await identityGate(root)
}
