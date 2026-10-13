// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/dom'
import { expect, it, vi } from 'vitest'
import { BusinessScope } from '../src/desktop-business-scope.tsx'

it.each([false, true])('validates the selected environment before saving or retaining the current scope (rejected=%s)', async (rejected) => {
  const validate = rejected ? vi.fn().mockRejectedValue(new Error('scope denied')) : vi.fn().mockResolvedValue({})
  const save = vi.fn().mockResolvedValue({})
  const changed = vi.fn()
  Object.defineProperty(window, 'dshEnterprise', { configurable: true, value: { validateRuntimeScope: validate, savePreferences: save } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => { root.render(createElement(BusinessScope, {
      tenant: { id: 'tenant', displayName: 'Tenant', roles: ['employee'], projects: [
        { id: 'project', tenantId: 'tenant', name: 'Project', createdAt: '2026-10-13' },
      ], environments: [
        { id: 'production', tenantId: 'tenant', name: 'production', kind: 'production', status: 'active', createdAt: '2026-10-13' },
        { id: 'development', tenantId: 'tenant', name: 'development', kind: 'development', status: 'active', createdAt: '2026-10-13' },
      ] },
      scope: { projectId: 'project', environmentId: 'production' },
      preferences: { userId: 'user', pinnedIds: [], hiddenOptionalIds: [], navigationOrder: [], version: 1, updatedAt: '2026-10-13' },
      onChanged: changed,
    })) })
    await act(async () => { fireEvent.change(screen.getByLabelText('业务环境'), { target: { value: 'development' } }) })
    expect(validate).toHaveBeenCalledWith({ projectId: 'project', environmentId: 'development' })
    if (rejected) {
      expect(save).not.toHaveBeenCalled()
      expect(changed).not.toHaveBeenCalled()
      expect((screen.getByLabelText('业务环境') as HTMLSelectElement).value).toBe('production')
      expect(screen.getByRole('alert').textContent).toBe('工作范围切换失败，请重试。')
    } else {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultProjectId: 'project', defaultEnvironmentId: 'development' }))
      expect(changed).toHaveBeenCalledOnce()
    }
  } finally { await act(async () => { root.unmount() }); host.remove(); vi.restoreAllMocks() }
})
