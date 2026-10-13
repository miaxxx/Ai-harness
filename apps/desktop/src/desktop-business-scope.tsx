/** Project/environment selection shares the native validated scope and server preferences. */
import { useState } from 'react'
import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import type { DesktopEnterpriseTenantContext, DesktopUserPreference } from './desktop-obis-identity-shared.ts'
import css from './desktop-business-navigation.module.css'

interface ScopeProps {
  tenant: DesktopEnterpriseTenantContext
  scope: DesktopEnterpriseScopeRequest
  preferences: DesktopUserPreference
  onChanged(): void
}

/**
 * Select a server-validated scope before replacing the conversation runtime.
 * @param props Current tenant directory and persisted preferences.
 * @returns Compact scope form; failed validation retains the current selection.
 */
export function BusinessScope({ tenant, scope, preferences, onChanged }: ScopeProps) {
  const [projectId, setProject] = useState(scope.projectId)
  const [environmentId, setEnvironment] = useState(scope.environmentId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const change = async (next: DesktopEnterpriseScopeRequest): Promise<void> => {
    setBusy(true)
    setError(undefined)
    let scopeChanged = false
    try {
      await window.dshEnterprise.validateRuntimeScope(next)
      scopeChanged = true
      await window.dshEnterprise.savePreferences({
        pinnedIds: preferences.pinnedIds, hiddenOptionalIds: preferences.hiddenOptionalIds,
        navigationOrder: preferences.navigationOrder,
        defaultProjectId: next.projectId, defaultEnvironmentId: next.environmentId,
      })
      onChanged()
    } catch {
      if (scopeChanged) {
        try { await window.dshEnterprise.validateRuntimeScope(scope) } catch {
          setError('企业身份已变化，请重新登录。')
          return
        }
      }
      setProject(scope.projectId)
      setEnvironment(scope.environmentId)
      setError('工作范围切换失败，请重试。')
    } finally { setBusy(false) }
  }
  return <div className={css.scope}>
    <label>项目<select aria-label="业务项目" value={projectId} disabled={busy}
      onChange={(event) => { setProject(event.target.value); void change({ projectId: event.target.value, environmentId }) }}>
      {tenant.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <label>环境<select aria-label="业务环境" value={environmentId} disabled={busy}
      onChange={(event) => { setEnvironment(event.target.value); void change({ projectId, environmentId: event.target.value }) }}>
      {tenant.environments.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>
        {({ development: '开发', staging: '预发布', production: '生产', custom: '自定义' })[item.kind]} · {item.name}
      </option>)}
    </select></label>
    {error && <p className={css.error} role="alert">{error}</p>}
  </div>
}
