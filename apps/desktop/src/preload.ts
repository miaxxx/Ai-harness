/** Sandboxed preload: expose only fixed ACP product operations. */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopRendererFrame } from './shared.ts'

const bridge: DesktopBridge = {
  workspace: () => ipcRenderer.invoke('dsh:workspace') as Promise<string>,
  listSessions: () => ipcRenderer.invoke('dsh:session-list') as ReturnType<DesktopBridge['listSessions']>,
  createSession: () => ipcRenderer.invoke('dsh:session-create') as ReturnType<DesktopBridge['createSession']>,
  loadSession: sessionId => ipcRenderer.invoke('dsh:session-load', sessionId) as ReturnType<DesktopBridge['loadSession']>,
  prompt: (sessionId, text) => ipcRenderer.invoke('dsh:session-prompt', sessionId, text) as ReturnType<DesktopBridge['prompt']>,
  cancel: sessionId => { ipcRenderer.send('dsh:session-cancel', sessionId) },
  closeSession: sessionId => ipcRenderer.invoke('dsh:session-close', sessionId) as ReturnType<DesktopBridge['closeSession']>,
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, frame: DesktopRendererFrame): void => { listener(frame) }
    ipcRenderer.on('dsh:frame', receive)
    return () => { ipcRenderer.off('dsh:frame', receive) }
  },
  restartRuntime: () => ipcRenderer.invoke('dsh:runtime-restart') as Promise<void>,
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
