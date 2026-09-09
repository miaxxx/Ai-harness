import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopObisIdentityBridge } from './desktop-obis-identity-shared.ts'

const bridge: DesktopObisIdentityBridge = {
  status: () => ipcRenderer.invoke('dsh:obis-identity-status') as ReturnType<DesktopObisIdentityBridge['status']>,
  configure: configuration => ipcRenderer.invoke(
    'dsh:obis-identity-configure',
    configuration,
  ) as ReturnType<DesktopObisIdentityBridge['configure']>,
  startDeviceAuthorization: () => ipcRenderer.invoke(
    'dsh:obis-identity-device-start',
  ) as ReturnType<DesktopObisIdentityBridge['startDeviceAuthorization']>,
  exchangeDeviceAuthorization: deviceCode => ipcRenderer.invoke(
    'dsh:obis-identity-device-exchange',
    deviceCode,
  ) as ReturnType<DesktopObisIdentityBridge['exchangeDeviceAuthorization']>,
  refresh: () => ipcRenderer.invoke('dsh:obis-identity-refresh') as ReturnType<DesktopObisIdentityBridge['refresh']>,
  logout: () => ipcRenderer.invoke('dsh:obis-identity-logout') as ReturnType<DesktopObisIdentityBridge['logout']>,
  context: () => ipcRenderer.invoke('dsh:obis-context') as ReturnType<DesktopObisIdentityBridge['context']>,
  switchTenant: tenantId => ipcRenderer.invoke(
    'dsh:obis-switch-tenant',
    tenantId,
  ) as ReturnType<DesktopObisIdentityBridge['switchTenant']>,
  workspace: () => ipcRenderer.invoke('dsh:obis-workspace') as ReturnType<DesktopObisIdentityBridge['workspace']>,
  savePreferences: value => ipcRenderer.invoke(
    'dsh:obis-workspace-preferences',
    value,
  ) as ReturnType<DesktopObisIdentityBridge['savePreferences']>,
  devices: () => ipcRenderer.invoke('dsh:obis-devices') as ReturnType<DesktopObisIdentityBridge['devices']>,
  revokeDevice: installationId => ipcRenderer.invoke(
    'dsh:obis-device-revoke',
    installationId,
  ) as ReturnType<DesktopObisIdentityBridge['revokeDevice']>,
  listWorkspaceDefinitions: () => ipcRenderer.invoke(
    'dsh:obis-workspace-definitions',
  ) as ReturnType<DesktopObisIdentityBridge['listWorkspaceDefinitions']>,
  saveWorkspaceDefinition: (id, value) => ipcRenderer.invoke(
    'dsh:obis-workspace-definition-save',
    id,
    value,
  ) as ReturnType<DesktopObisIdentityBridge['saveWorkspaceDefinition']>,
  overview: scope => ipcRenderer.invoke(
    'dsh:enterprise-overview',
    scope,
  ) as ReturnType<DesktopObisIdentityBridge['overview']>,
  decideApproval: input => ipcRenderer.invoke(
    'dsh:enterprise-approval-decision',
    input,
  ) as ReturnType<DesktopObisIdentityBridge['decideApproval']>,
  transitionEnvironment: input => ipcRenderer.invoke(
    'dsh:enterprise-environment-transition',
    input,
  ) as ReturnType<DesktopObisIdentityBridge['transitionEnvironment']>,
  requestMaintenance: input => ipcRenderer.invoke(
    'dsh:enterprise-maintenance-request',
    input,
  ) as ReturnType<DesktopObisIdentityBridge['requestMaintenance']>,
  updateDirectoryUser: input => ipcRenderer.invoke(
    'dsh:enterprise-directory-user-update',
    input,
  ) as ReturnType<DesktopObisIdentityBridge['updateDirectoryUser']>,
  validateRuntimeScope: input => ipcRenderer.invoke(
    'dsh:enterprise-runtime-scope-validate',
    input,
  ) as ReturnType<DesktopObisIdentityBridge['validateRuntimeScope']>,
}

contextBridge.exposeInMainWorld('dshEnterprise', bridge)
