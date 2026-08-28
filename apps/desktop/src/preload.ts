/** Sandboxed preload: expose only the fixed desktop transport operations. */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopRendererFrame } from './shared.ts'

const bridge: DesktopBridge = {
  start: request => ipcRenderer.invoke('dsh:fetch-start', request) as Promise<Awaited<ReturnType<DesktopBridge['start']>>>,
  resume: (id) => { ipcRenderer.send('dsh:fetch-resume', id) },
  cancel: (id) => { ipcRenderer.send('dsh:fetch-cancel', id) },
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, frame: DesktopRendererFrame): void => { listener(frame) }
    ipcRenderer.on('dsh:frame', receive)
    return () => { ipcRenderer.off('dsh:frame', receive) }
  },
  restartHost: () => ipcRenderer.invoke('dsh:host-restart') as Promise<void>,
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
