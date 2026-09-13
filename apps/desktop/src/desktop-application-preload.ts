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
}

contextBridge.exposeInMainWorld('dshApplications', bridge)
