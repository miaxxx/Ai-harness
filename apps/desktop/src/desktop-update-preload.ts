import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopUpdateBridge, DesktopUpdateState } from './desktop-update-shared.ts'

const bridge: DesktopUpdateBridge = {
  state: () => ipcRenderer.invoke('dsh:desktop-update-state') as Promise<DesktopUpdateState>,
  check: () => ipcRenderer.invoke('dsh:desktop-update-check') as Promise<DesktopUpdateState>,
  download: () => ipcRenderer.invoke('dsh:desktop-update-download') as Promise<DesktopUpdateState>,
  install: () => ipcRenderer.invoke('dsh:desktop-update-install') as Promise<void>,
  onState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, value: DesktopUpdateState) => listener(value)
    ipcRenderer.on('dsh:desktop-update-state', handler)
    return () => ipcRenderer.removeListener('dsh:desktop-update-state', handler)
  },
}

contextBridge.exposeInMainWorld('dshDesktopUpdate', bridge)
