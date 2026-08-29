/** Sandboxed preload: expose only fixed ACP product operations. */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopRendererFrame } from './shared.ts'

const bridge: DesktopBridge = {
  workspace: () => ipcRenderer.invoke('dsh:workspace') as Promise<string>,
  listSessions: cwd => ipcRenderer.invoke('dsh:session-list', cwd) as ReturnType<DesktopBridge['listSessions']>,
  createSession: cwd => ipcRenderer.invoke('dsh:session-create', cwd) as ReturnType<DesktopBridge['createSession']>,
  loadSession: (sessionId, cwd) => ipcRenderer.invoke('dsh:session-load', sessionId, cwd) as ReturnType<DesktopBridge['loadSession']>,
  prompt: (sessionId, text) => ipcRenderer.invoke('dsh:session-prompt', sessionId, text) as ReturnType<DesktopBridge['prompt']>,
  cancel: (sessionId) => { ipcRenderer.send('dsh:session-cancel', sessionId) },
  closeSession: sessionId => ipcRenderer.invoke('dsh:session-close', sessionId) as ReturnType<DesktopBridge['closeSession']>,
  pickDirectory: () => ipcRenderer.invoke('dsh:directory-pick') as ReturnType<DesktopBridge['pickDirectory']>,
  listDirectory: path => ipcRenderer.invoke('dsh:directory-list', path) as ReturnType<DesktopBridge['listDirectory']>,
  createDirectory: (path, name) => ipcRenderer.invoke('dsh:directory-create', path, name) as ReturnType<DesktopBridge['createDirectory']>,
  openPath: path => ipcRenderer.invoke('dsh:path-open', path) as ReturnType<DesktopBridge['openPath']>,
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, frame: DesktopRendererFrame): void => { listener(frame) }
    ipcRenderer.on('dsh:frame', receive)
    return () => { ipcRenderer.off('dsh:frame', receive) }
  },
  restartRuntime: () => ipcRenderer.invoke('dsh:runtime-restart') as Promise<void>,
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
