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
  tasks: input => ipcRenderer.invoke(
    'dsh:application-tasks',
    input,
  ) as ReturnType<DesktopApplicationBridge['tasks']>,
  transitionTask: input => ipcRenderer.invoke(
    'dsh:application-task-transition',
    input,
  ) as ReturnType<DesktopApplicationBridge['transitionTask']>,
  approvalInbox: input => ipcRenderer.invoke(
    'dsh:application-approval-inbox',
    input,
  ) as ReturnType<DesktopApplicationBridge['approvalInbox']>,
  decideApproval: input => ipcRenderer.invoke(
    'dsh:application-approval-decision',
    input,
  ) as ReturnType<DesktopApplicationBridge['decideApproval']>,
  searchKnowledge: input => ipcRenderer.invoke(
    'dsh:application-knowledge',
    input,
  ) as ReturnType<DesktopApplicationBridge['searchKnowledge']>,
  ai: input => ipcRenderer.invoke(
    'dsh:application-ai',
    input,
  ) as ReturnType<DesktopApplicationBridge['ai']>,
}

contextBridge.exposeInMainWorld('dshApplications', bridge)

contextBridge.exposeInMainWorld('dshBusiness', {
  onSessionEnded: (listener: () => void): (() => void) => {
    const receive = (): void => { listener() }
    ipcRenderer.on('dsh:business-session-ended', receive)
    return () => { ipcRenderer.removeListener('dsh:business-session-ended', receive) }
  },
  prepare: (): Promise<void> => ipcRenderer.invoke('dsh:business-prepare') as Promise<void>,
  openEntry: (entry: import('./desktop-application-shared.ts').DesktopBusinessEntry): Promise<void> => ipcRenderer.invoke('dsh:business-entry', entry) as Promise<void>,
  hide: (): Promise<void> => ipcRenderer.invoke('dsh:business-hide') as Promise<void>,
  setBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> => ipcRenderer.invoke('dsh:business-bounds', bounds) as Promise<void>,
  openPage: (input: import('./desktop-application-shared.ts').DesktopApplicationPageRequest): Promise<void> => ipcRenderer.invoke('dsh:business-page', input) as Promise<void>,
})
