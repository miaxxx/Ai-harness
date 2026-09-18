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
  previewPage: input => ipcRenderer.invoke(
    'dsh:application-preview-page',
    input,
  ) as ReturnType<DesktopApplicationBridge['previewPage']>,
  query: input => ipcRenderer.invoke(
    'dsh:application-query',
    input,
  ) as ReturnType<DesktopApplicationBridge['query']>,
  action: input => ipcRenderer.invoke(
    'dsh:application-action',
    input,
  ) as ReturnType<DesktopApplicationBridge['action']>,
  approval: input => ipcRenderer.invoke(
    'dsh:application-approval',
    input,
  ) as ReturnType<DesktopApplicationBridge['approval']>,
  ai: input => ipcRenderer.invoke(
    'dsh:application-ai',
    input,
  ) as ReturnType<DesktopApplicationBridge['ai']>,
}

contextBridge.exposeInMainWorld('dshApplications', bridge)
