/** Sandboxed preload: expose only fixed ACP product operations. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAttachmentPaste, DesktopBridge, DesktopRendererFrame } from './shared.ts'
import './desktop-obis-identity-preload.ts'

const pendingFrames: DesktopRendererFrame[] = []
const listeners = new Set<(frame: DesktopRendererFrame) => void>()
const previewListeners = new Set<(url: string) => void>()

ipcRenderer.on('dsh:frame', (_event, frame: DesktopRendererFrame) => {
  if (listeners.size === 0) {
    pendingFrames.push(frame)
    return
  }
  for (const listener of [...listeners]) listener(frame)
})

ipcRenderer.on('dsh:preview-request', (_event, url: unknown) => {
  if (typeof url !== 'string') return
  for (const listener of [...previewListeners]) listener(url)
})

const bridge: DesktopBridge = {
  workspace: () => ipcRenderer.invoke('dsh:workspace') as Promise<string>,
  listSessions: cwd => ipcRenderer.invoke('dsh:session-list', cwd) as ReturnType<DesktopBridge['listSessions']>,
  createSession: cwd => ipcRenderer.invoke('dsh:session-create', cwd) as ReturnType<DesktopBridge['createSession']>,
  loadSession: (sessionId, cwd) => ipcRenderer.invoke('dsh:session-load', sessionId, cwd) as ReturnType<DesktopBridge['loadSession']>,
  prompt: (sessionId, prompt) => ipcRenderer.invoke('dsh:session-prompt', sessionId, prompt) as ReturnType<DesktopBridge['prompt']>,
  cancel: (sessionId) => { ipcRenderer.send('dsh:session-cancel', sessionId) },
  closeSession: sessionId => ipcRenderer.invoke('dsh:session-close', sessionId) as ReturnType<DesktopBridge['closeSession']>,
  pickDirectory: () => ipcRenderer.invoke('dsh:directory-pick') as ReturnType<DesktopBridge['pickDirectory']>,
  listDirectory: path => ipcRenderer.invoke('dsh:directory-list', path) as ReturnType<DesktopBridge['listDirectory']>,
  createDirectory: (path, name) => ipcRenderer.invoke('dsh:directory-create', path, name) as ReturnType<DesktopBridge['createDirectory']>,
  openPath: path => ipcRenderer.invoke('dsh:path-open', path) as ReturnType<DesktopBridge['openPath']>,
  preparePreview: path => ipcRenderer.invoke('dsh:preview-prepare', path) as ReturnType<DesktopBridge['preparePreview']>,
  openExternal: url => ipcRenderer.invoke('dsh:url-open-external', url) as ReturnType<DesktopBridge['openExternal']>,
  subscribePreviewRequest(listener) {
    previewListeners.add(listener)
    return () => { previewListeners.delete(listener) }
  },
  listSkills: cwd => ipcRenderer.invoke('dsh:skill-list', cwd) as ReturnType<DesktopBridge['listSkills']>,
  importSkill: () => ipcRenderer.invoke('dsh:skill-import') as ReturnType<DesktopBridge['importSkill']>,
  removeSkill: name => ipcRenderer.invoke('dsh:skill-remove', name) as ReturnType<DesktopBridge['removeSkill']>,
  pickAttachments: (sessionId, cwd) => ipcRenderer.invoke('dsh:attachment-pick', sessionId, cwd) as ReturnType<DesktopBridge['pickAttachments']>,
  pasteAttachments: (sessionId, cwd, paste) => ipcRenderer.invoke('dsh:attachment-paste', sessionId, cwd, paste) as ReturnType<DesktopBridge['pasteAttachments']>,
  referenceAttachments: (sessionId, cwd, paths) => ipcRenderer.invoke('dsh:attachment-reference', sessionId, cwd, paths) as ReturnType<DesktopBridge['referenceAttachments']>,
  subscribeAttachmentPaste(listener) {
    const handlePaste = (event: ClipboardEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement) || target.disabled || target.readOnly) return
      const files = Array.from(event.clipboardData?.files ?? [])
      const paths = files.map(file => webUtils.getPathForFile(file)).filter(path => path !== '')
      const hasClipboardImage = Array.from(event.clipboardData?.types ?? []).some(type => type.startsWith('image/'))
      const imageWithoutPath = files.some(file => file.type.startsWith('image/') && webUtils.getPathForFile(file) === '')
        || (paths.length === 0 && hasClipboardImage)
      const hasFileUrl = event.clipboardData?.types.includes('text/uri-list') === true
      if (paths.length === 0 && !imageWithoutPath && !hasFileUrl) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const paste: DesktopAttachmentPaste = {
        paths,
        imageWithoutPath,
        selection: { start: target.selectionStart, end: target.selectionEnd },
      }
      listener(paste)
    }
    window.addEventListener('paste', handlePaste, true)
    return () => { window.removeEventListener('paste', handlePaste, true) }
  },
  removeAttachment: (sessionId, attachmentId) => ipcRenderer.invoke('dsh:attachment-remove', sessionId, attachmentId) as ReturnType<DesktopBridge['removeAttachment']>,
  saveArtifact: (sessionId, path) => ipcRenderer.invoke('dsh:artifact-save', sessionId, path) as ReturnType<DesktopBridge['saveArtifact']>,
  exportArtifacts: sessionId => ipcRenderer.invoke('dsh:artifact-export', sessionId) as ReturnType<DesktopBridge['exportArtifacts']>,
  modelSettings: () => ipcRenderer.invoke('dsh:model-settings') as ReturnType<DesktopBridge['modelSettings']>,
  saveModelSettings: update => ipcRenderer.invoke('dsh:model-settings-save', update) as ReturnType<DesktopBridge['saveModelSettings']>,
  webSearchSettings: () => ipcRenderer.invoke('dsh:web-search-settings') as ReturnType<DesktopBridge['webSearchSettings']>,
  saveWebSearchSettings: update => ipcRenderer.invoke('dsh:web-search-settings-save', update) as ReturnType<DesktopBridge['saveWebSearchSettings']>,
  listMcpServers: () => ipcRenderer.invoke('dsh:mcp-list') as ReturnType<DesktopBridge['listMcpServers']>,
  saveMcpServer: update => ipcRenderer.invoke('dsh:mcp-save', update) as ReturnType<DesktopBridge['saveMcpServer']>,
  removeMcpServer: serverName => ipcRenderer.invoke('dsh:mcp-remove', serverName) as ReturnType<DesktopBridge['removeMcpServer']>,
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
