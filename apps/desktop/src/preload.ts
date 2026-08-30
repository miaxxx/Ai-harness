/** Sandboxed preload: expose only fixed ACP product operations. */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopRendererFrame } from './shared.ts'

const pendingFrames: DesktopRendererFrame[] = []
const listeners = new Set<(frame: DesktopRendererFrame) => void>()

ipcRenderer.on('dsh:frame', (_event, frame: DesktopRendererFrame) => {
  if (listeners.size === 0) {
    pendingFrames.push(frame)
    return
  }
  for (const listener of [...listeners]) listener(frame)
})

const bridge: DesktopBridge = {
  workspace: () => ipcRenderer.invoke('dsh:workspace') as Promise<string>,
  listSessions: cwd => ipcRenderer.invoke('dsh:session-list', cwd) as ReturnType<DesktopBridge['listSessions']>,
  createSession: cwd => ipcRenderer.invoke('dsh:session-create', cwd) as ReturnType<DesktopBridge['createSession']>,
  loadSession: (sessionId, cwd) => ipcRenderer.invoke('dsh:session-load', sessionId, cwd) as ReturnType<DesktopBridge['loadSession']>,
  prompt: (sessionId, text, attachmentIds) => ipcRenderer.invoke('dsh:session-prompt', sessionId, text, attachmentIds) as ReturnType<DesktopBridge['prompt']>,
  cancel: (sessionId) => { ipcRenderer.send('dsh:session-cancel', sessionId) },
  closeSession: sessionId => ipcRenderer.invoke('dsh:session-close', sessionId) as ReturnType<DesktopBridge['closeSession']>,
  pickDirectory: () => ipcRenderer.invoke('dsh:directory-pick') as ReturnType<DesktopBridge['pickDirectory']>,
  listDirectory: path => ipcRenderer.invoke('dsh:directory-list', path) as ReturnType<DesktopBridge['listDirectory']>,
  createDirectory: (path, name) => ipcRenderer.invoke('dsh:directory-create', path, name) as ReturnType<DesktopBridge['createDirectory']>,
  openPath: path => ipcRenderer.invoke('dsh:path-open', path) as ReturnType<DesktopBridge['openPath']>,
  listSkills: cwd => ipcRenderer.invoke('dsh:skill-list', cwd) as ReturnType<DesktopBridge['listSkills']>,
  importSkill: () => ipcRenderer.invoke('dsh:skill-import') as ReturnType<DesktopBridge['importSkill']>,
  removeSkill: name => ipcRenderer.invoke('dsh:skill-remove', name) as ReturnType<DesktopBridge['removeSkill']>,
  pickAttachments: (sessionId, cwd) => ipcRenderer.invoke('dsh:attachment-pick', sessionId, cwd) as ReturnType<DesktopBridge['pickAttachments']>,
  removeAttachment: (sessionId, attachmentId) => ipcRenderer.invoke('dsh:attachment-remove', sessionId, attachmentId) as ReturnType<DesktopBridge['removeAttachment']>,
  saveArtifact: (sessionId, path) => ipcRenderer.invoke('dsh:artifact-save', sessionId, path) as ReturnType<DesktopBridge['saveArtifact']>,
  exportArtifacts: sessionId => ipcRenderer.invoke('dsh:artifact-export', sessionId) as ReturnType<DesktopBridge['exportArtifacts']>,
  modelSettings: () => ipcRenderer.invoke('dsh:model-settings') as ReturnType<DesktopBridge['modelSettings']>,
  saveModelSettings: update => ipcRenderer.invoke('dsh:model-settings-save', update) as ReturnType<DesktopBridge['saveModelSettings']>,
  subscribe(listener) {
    listeners.add(listener)
    if (pendingFrames.length > 0) {
      const buffered = pendingFrames.splice(0)
      for (const frame of buffered) listener(frame)
    }
    return () => { listeners.delete(listener) }
  },
  restartRuntime: () => ipcRenderer.invoke('dsh:runtime-restart') as Promise<void>,
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
