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
  eyebrow.textContent = 'OBIS 企业工作台'
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
  const { card, message } = renderShell(root, '连接企业工作台', '连接 OBIS 企业服务。登录凭证由系统安全存储保护。')
  const form = element('div', 'obis-enterprise-fields')
  const urlLabel = element('label'); urlLabel.textContent = '企业服务地址'
  const url = element('input'); url.type = 'url'; url.placeholder = 'https://obis.example.com'
  const tenantLabel = element('label'); tenantLabel.textContent = '租户'
  const tenant = element('input'); tenant.placeholder = 'acme'
  urlLabel.append(url); tenantLabel.append(tenant); form.append(urlLabel, tenantLabel)
  const save = button('连接', () => {
    save.disabled = true
    setMessage(message, '正在验证企业服务……')
    void window.dshEnterprise.configure({ baseURL: url.value, tenantId: tenant.value })
      .then(() => identityGate(root))
      .catch((error: unknown) => { setMessage(message, publicError(error), 'error'); save.disabled = false })
  })
  card.append(form, save)
}

function loginView(root: HTMLElement, status: DesktopObisIdentityStatus): void {
  const { card, message } = renderShell(root, '登录企业工作台', `企业服务：${status.baseURL ?? 'OBIS'} · 租户：${status.tenantId ?? '未选择'}`)
  const form = element('div', 'obis-enterprise-fields')
  const emailLabel = element('label'); emailLabel.textContent = '邮箱'
  const email = element('input'); email.type = 'email'; email.autocomplete = 'username'; email.placeholder = 'name@example.com'
  const passwordLabel = element('label'); passwordLabel.textContent = '密码'
  const password = element('input'); password.type = 'password'; password.autocomplete = 'current-password'
  emailLabel.append(email); passwordLabel.append(password); form.append(emailLabel, passwordLabel)
  const signIn = button('登录', () => {
    signIn.disabled = true
    setMessage(message, '正在登录……')
    void window.dshEnterprise.signInWithPassword({ email: email.value, password: password.value })
      .then(async () => {
        password.value = ''
        setMessage(message, '登录成功，正在打开工作台……')
        await identityGate(root)
      })
      .catch((error: unknown) => { password.value = ''; setMessage(message, publicError(error), 'error'); signIn.disabled = false })
  })
  card.append(form, signIn)
}

function installIdentityBadge(status: DesktopObisIdentityStatus): void {
  document.getElementById('obis-enterprise-identity')?.remove()
  if (document.querySelector('[data-enterprise-shell="true"], [aria-label="OBIS 工作区"]')) return
  const badge = element('div', 'obis-enterprise-identity')
  badge.id = 'obis-enterprise-identity'
  const identity = element('span')
  identity.textContent = `${status.user?.displayName ?? status.user?.id ?? '企业用户'} · ${status.tenantId ?? ''}`
  const logout = button('退出登录', () => { logout.disabled = true; void window.dshEnterprise.logout().finally(() => { window.location.reload() }) })
  badge.append(identity, logout)
  document.body.append(badge)
}

let productMounted = false
let productMount: (() => Promise<void>) | undefined

async function identityGate(root: HTMLElement): Promise<void> {
  let status: DesktopObisIdentityStatus
  try { status = await window.dshEnterprise.status() }
  catch (error: unknown) {
    const { card, message } = renderShell(root, '登录状态暂不可用', '无法验证已保存的企业登录状态。')
    setMessage(message, publicError(error), 'error')
    card.append(button('重试', () => { void identityGate(root) }))
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
        '已登录',
        `已通过 ${status.baseURL ?? 'OBIS'} 登录：${status.user?.primaryEmail ?? status.user?.displayName ?? '企业用户'}。`,
      )
      setMessage(message, publicError(error), 'error')
      card.append(button('重试', () => { void identityGate(root) }))
    }
  }
  installIdentityBadge(status)
}

export async function mountDesktopEnterpriseIdentity(root: HTMLElement, mountProduct: () => Promise<void>): Promise<void> {
  productMount = mountProduct
  await identityGate(root)
}
