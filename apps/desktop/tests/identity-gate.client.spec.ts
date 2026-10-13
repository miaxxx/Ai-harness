// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/dom'
import { mountDesktopEnterpriseIdentity } from '../src/desktop-obis-identity-ui.ts'

it('lets a signed-out employee change enterprise while preserving the configured service address', async () => {
  const configure = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'dshEnterprise', { configurable: true, value: {
    status: vi.fn().mockResolvedValue({
      configured: true, authenticated: false, required: true,
      baseURL: 'https://api.example.test', businessWebURL: 'https://app.example.test/', tenantId: 'old-tenant',
    }),
    configure,
  } })
  const root = document.createElement('div')
  document.body.append(root)
  try {
    await mountDesktopEnterpriseIdentity(root, async () => {})
    fireEvent.click(screen.getByRole('button', { name: '更换企业' }))
    const service = screen.getByLabelText('企业服务地址') as HTMLInputElement
    const tenant = screen.getByLabelText('租户') as HTMLInputElement
    expect(service.value).toBe('https://api.example.test')
    expect(tenant.value).toBe('old-tenant')
    fireEvent.change(tenant, { target: { value: 'new-tenant' } })
    fireEvent.click(screen.getByRole('button', { name: /^连接$/ }))
    expect(configure).toHaveBeenCalledWith({
      baseURL: 'https://api.example.test', tenantId: 'new-tenant', businessWebURL: 'https://app.example.test/',
    })
  } finally { root.remove(); vi.restoreAllMocks() }
})
