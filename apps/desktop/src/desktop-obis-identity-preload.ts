import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopObisIdentityBridge } from './desktop-obis-identity-shared.ts'

const bridge: DesktopObisIdentityBridge = {
  status: () => ipcRenderer.invoke('dsh:obis-identity-status') as ReturnType<DesktopObisIdentityBridge['status']>,
  configure: configuration => ipcRenderer.invoke('dsh:obis-identity-configure', configuration) as ReturnType<DesktopObisIdentityBridge['configure']>,
  startDeviceAuthorization: () => ipcRenderer.invoke('dsh:obis-identity-device-start') as ReturnType<DesktopObisIdentityBridge['startDeviceAuthorization']>,
  exchangeDeviceAuthorization: deviceCode => ipcRenderer.invoke('dsh:obis-identity-device-exchange', deviceCode) as ReturnType<DesktopObisIdentityBridge['exchangeDeviceAuthorization']>,
  refresh: () => ipcRenderer.invoke('dsh:obis-identity-refresh') as ReturnType<DesktopObisIdentityBridge['refresh']>,
  logout: () => ipcRenderer.invoke('dsh:obis-identity-logout') as ReturnType<DesktopObisIdentityBridge['logout']>,
}

contextBridge.exposeInMainWorld('dshEnterprise', bridge)
