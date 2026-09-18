import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApplicationBridge } from './desktop-application-shared.ts'

const bridge: DesktopApplicationBridge = {
  navigation: scope => ipcRenderer.invoke(
    'dsh:application-navigation',
    scope,
  ) as ReturnType<DesktopApplicationBridge['navigation']>,
  page: input => ipcRenderer.invoke(
    'dsh:application-page',
    input,
  ) as ReturnType<DesktopApplicationBridge['page']>,
  query: input => ipcRenderer.invoke(
    'dsh:application-query',
    input,
  ) as ReturnType<DesktopApplicationBridge['query']>,
  action: input => ipcRenderer.invoke(
    'dsh:application-action',
    input,
  ) as ReturnType<DesktopApplicationBridge['action']>,
}

contextBridge.exposeInMainWorld('dshApplications', bridge)
