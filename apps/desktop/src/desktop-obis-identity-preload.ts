import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopObisIdentityBridge } from './desktop-obis-identity-shared.ts'

const bridge:DesktopObisIdentityBridge={
  status:()=>ipcRenderer.invoke('dsh:obis-identity-status') as ReturnType<DesktopObisIdentityBridge['status']>,
  configure:configuration=>ipcRenderer.invoke('dsh:obis-identity-configure',configuration) as ReturnType<DesktopObisIdentityBridge['configure']>,
  startDeviceAuthorization:()=>ipcRenderer.invoke('dsh:obis-identity-device-start') as ReturnType<DesktopObisIdentityBridge['startDeviceAuthorization']>,
  exchangeDeviceAuthorization:deviceCode=>ipcRenderer.invoke('dsh:obis-identity-device-exchange',deviceCode) as ReturnType<DesktopObisIdentityBridge['exchangeDeviceAuthorization']>,
  refresh:()=>ipcRenderer.invoke('dsh:obis-identity-refresh') as ReturnType<DesktopObisIdentityBridge['refresh']>,
  logout:()=>ipcRenderer.invoke('dsh:obis-identity-logout') as ReturnType<DesktopObisIdentityBridge['logout']>,
  context:()=>ipcRenderer.invoke('dsh:obis-context') as ReturnType<DesktopObisIdentityBridge['context']>,
  switchTenant:tenantId=>ipcRenderer.invoke('dsh:obis-switch-tenant',tenantId) as ReturnType<DesktopObisIdentityBridge['switchTenant']>,
  workspace:()=>ipcRenderer.invoke('dsh:obis-workspace') as ReturnType<DesktopObisIdentityBridge['workspace']>,
  savePreferences:value=>ipcRenderer.invoke('dsh:obis-workspace-preferences',value) as ReturnType<DesktopObisIdentityBridge['savePreferences']>,
  devices:()=>ipcRenderer.invoke('dsh:obis-devices') as ReturnType<DesktopObisIdentityBridge['devices']>,
  revokeDevice:installationId=>ipcRenderer.invoke('dsh:obis-device-revoke',installationId) as ReturnType<DesktopObisIdentityBridge['revokeDevice']>,
  listWorkspaceDefinitions:()=>ipcRenderer.invoke('dsh:obis-workspace-definitions') as ReturnType<DesktopObisIdentityBridge['listWorkspaceDefinitions']>,
  saveWorkspaceDefinition:(id,value)=>ipcRenderer.invoke('dsh:obis-workspace-definition-save',id,value) as ReturnType<DesktopObisIdentityBridge['saveWorkspaceDefinition']>,
}
contextBridge.exposeInMainWorld('dshEnterprise',bridge)
