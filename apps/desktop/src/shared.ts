import type { SessionNotification } from '@agentclientprotocol/sdk'
import type { DesktopPromptPart } from './desktop-prompt.ts'

/** Durable Session metadata safe to expose to the sandboxed Renderer. */
export interface DesktopSessionSummary {
  sessionId: string
  cwd: string
  title?: string
}

/** One filesystem breadcrumb projected by the privileged Main process. */
export interface DesktopDirectoryCrumb {
  name: string
  path: string
  hidden: boolean
}

/** One child entry in the typed Desktop directory browser. */
interface DesktopDirectoryEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
  hidden: boolean
}

/** Sandboxed directory listing used by the product Workspace picker. */
export interface DesktopDirectoryListing {
  path: string
  home: string
  crumbs: DesktopDirectoryCrumb[]
  entries: DesktopDirectoryEntry[]
  truncated: boolean
}

/** Result of one ACP prompt turn. */
export interface DesktopPromptResult {
  stopReason: string
  /** Files created or changed during this turn and copied into the Session artifact directory. */
  artifacts: DesktopArtifact[]
}

/** One effective Skill visible to the Desktop Runtime. */
export interface DesktopSkillSummary {
  name: string
  description: string
  source: 'user' | 'project' | 'bundled'
  removable: boolean
}

/** One filesystem item prepared for the next Desktop prompt. */
export interface DesktopAttachment {
  id: string
  name: string
  path: string
  mediaType: string
  kind: 'image' | 'file' | 'directory'
  size: number
}

/** Filesystem content observed in one native composer paste. */
export interface DesktopAttachmentPaste {
  /** Absolute source paths resolved by Electron from native clipboard files. */
  paths: readonly string[]
  /** Whether the clipboard also contains an image with no filesystem path. */
  imageWithoutPath: boolean
  /** Selection in the focused composer when the native paste was intercepted. */
  selection: { readonly start: number; readonly end: number }
}

/** One ordinary file captured as a durable output of a Session turn. */
export interface DesktopArtifact {
  name: string
  path: string
  relativePath: string
  mediaType: string
  size: number
}

/** Main-process result for one filesystem item requested by the preview panel. */
export type DesktopPreparedPreview =
  | { kind: 'directory'; path: string }
  | {
    kind: 'file'
    path: string
    url: string
    title: string
    mediaType: string
    previewable: boolean
  }

/** One active destination rendered by the Desktop preview panel. */
export type DesktopPreviewTarget =
  | {
    kind: 'browser'
    url: string
    title: string
    external: string
    mediaType: string
  }
  | {
    kind: 'external-file'
    path: string
    title: string
    mediaType: string
  }

/** OpenAI-compatible wire protocol selected for the Desktop primary model. */
export type DesktopModelProtocol = 'openai-completions' | 'openai-responses'

/** Capabilities verified against the configured Desktop model endpoint. */
export interface DesktopModelCapabilities {
  input: ('text' | 'image')[]
  contextWindow?: number
  maxOutputTokens?: number
  verified: boolean
}

/** Redacted primary-model configuration safe to expose to the Renderer. */
export interface DesktopModelSettings {
  configured: boolean
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  apiKeyConfigured: boolean
  computerUseEnabled: boolean
  capabilities: DesktopModelCapabilities
}

/** Writable primary-model fields; an empty API key preserves the stored secret. */
export interface DesktopModelSettingsUpdate {
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  apiKey: string
  computerUseEnabled: boolean
}

/** Redacted You.com web-search configuration safe to expose to the Renderer. */
export interface DesktopWebSearchSettings {
  apiKeyConfigured: boolean
}

/** Writable You.com key; an empty value preserves the encrypted key already stored. */
export interface DesktopWebSearchSettingsUpdate {
  apiKey: string
}

/** Transport selected for one user-owned MCP server. */
export type DesktopMcpTransport = 'stdio' | 'streamable-http'

/** Redacted MCP configuration safe to show in the sandboxed Renderer. */
export interface DesktopMcpServerSummary {
  serverName: string
  transport: DesktopMcpTransport
  target: string
  secretNames: string[]
  command?: string
  args?: string[]
  cwd?: string
  url?: string
}

/** One complete MCP server edit submitted by the settings Renderer. */
export interface DesktopMcpServerUpdate {
  serverName: string
  transport: DesktopMcpTransport
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  /** Omission preserves the current stdio environment or HTTP headers. */
  secrets?: Record<string, string>
}

/** Structured ACP Session notification forwarded without presentation loss. */
export type DesktopSessionNotification = SessionNotification

/** Low-authority API exposed by the context-isolated preload. */
export interface DesktopBridge {
  /** Initial Workspace suggested by the Desktop host. */
  workspace(): Promise<string>
  /** List durable Sessions for one Workspace (the initial Workspace when omitted). */
  listSessions(cwd?: string): Promise<DesktopSessionSummary[]>
  /** Create one fresh durable Session rooted at the requested Workspace. */
  createSession(cwd?: string): Promise<string>
  /** Restore one durable Session and replay its presentation updates. */
  loadSession(sessionId: string, cwd?: string): Promise<void>
  /** Prompt one live Session through ACP with ordered text and attachment parts. */
  prompt(sessionId: string, prompt: readonly DesktopPromptPart[]): Promise<DesktopPromptResult>
  /** Cancel the current turn for one live Session. */
  cancel(sessionId: string): void
  /** Release one live Session while retaining durable history. */
  closeSession(sessionId: string): Promise<void>
  /** Open the native directory chooser without exposing Electron primitives. */
  pickDirectory(): Promise<string | null>
  /** Read one directory level through the privileged filesystem boundary. */
  listDirectory(path?: string): Promise<DesktopDirectoryListing>
  /** Create one child directory and return its absolute path. */
  createDirectory(path: string, name: string): Promise<string>
  /** Ask the host OS to open one filesystem path with its default application. */
  openPath(path: string): Promise<void>
  /** Validate one local path and prepare browser-safe preview metadata. */
  preparePreview(path: string): Promise<DesktopPreparedPreview>
  /** Open an HTTP(S) URL in the user's external browser. */
  openExternal(url: string): Promise<void>
  /** Observe links from the product Renderer that were routed into the preview panel. */
  subscribePreviewRequest(listener: (url: string) => void): () => void
  /** List effective bundled, project, and user Skills for a Workspace. */
  listSkills(cwd: string): Promise<DesktopSkillSummary[]>
  /** Import a Skill folder or SKILL.md through the native picker. */
  importSkill(): Promise<DesktopSkillSummary | null>
  /** Remove one user-owned Skill. */
  removeSkill(name: string): Promise<void>
  /** Pick and stage image or ordinary-file attachments for one Session. */
  pickAttachments(sessionId: string, cwd: string): Promise<DesktopAttachment[]>
  /** Add filesystem paths or a pathless clipboard image to the pending attachments. */
  pasteAttachments(sessionId: string, cwd: string, paste: DesktopAttachmentPaste): Promise<DesktopAttachment[]>
  /** Reference known filesystem paths in the composer without reading the clipboard. */
  referenceAttachments(sessionId: string, cwd: string, paths: readonly string[]): Promise<DesktopAttachment[]>
  /** Observe native file/image paste gestures captured before the text composer. */
  subscribeAttachmentPaste(listener: (paste: DesktopAttachmentPaste) => void): () => void
  /** Remove a staged attachment before submission. */
  removeAttachment(sessionId: string, attachmentId: string): Promise<void>
  /** Copy one captured artifact to a user-selected destination. */
  saveArtifact(sessionId: string, path: string): Promise<string | null>
  /** Export every captured artifact in the Session as one ZIP archive. */
  exportArtifacts(sessionId: string): Promise<string | null>
  /** Read the redacted OpenAI-compatible primary-model configuration. */
  modelSettings(): Promise<DesktopModelSettings>
  /** Save the primary model, securely retain its key, and restart the ACP Runtime. */
  saveModelSettings(update: DesktopModelSettingsUpdate): Promise<DesktopModelSettings>
  /** Read whether a You.com key is configured without exposing its value. */
  webSearchSettings(): Promise<DesktopWebSearchSettings>
  /** Save the You.com key in encrypted storage and restart the ACP Runtime. */
  saveWebSearchSettings(update: DesktopWebSearchSettingsUpdate): Promise<DesktopWebSearchSettings>
  /** List redacted persistent MCP servers. */
  listMcpServers(): Promise<DesktopMcpServerSummary[]>
  /** Save one MCP server and restart the ACP Runtime so its tools become available. */
  saveMcpServer(update: DesktopMcpServerUpdate): Promise<DesktopMcpServerSummary[]>
  /** Remove one MCP server and restart the ACP Runtime. */
  removeMcpServer(serverName: string): Promise<DesktopMcpServerSummary[]>
  /** Subscribe to Runtime lifecycle and structured ACP presentation updates. */
  subscribe(listener: (frame: DesktopRendererFrame) => void): () => void
  /** Restart the supervised ACP Runtime process. */
  restartRuntime(): Promise<void>
}

/** Frames the Electron Main process may push into the Renderer. */
export type DesktopRendererFrame =
  | {
    type: 'runtime-status'
    status: 'starting' | 'ready' | 'stopped' | 'failed'
    message?: string
  }
  | {
    type: 'session-update'
    sessionId: string
    /** Preserve ACP semantics for the product client adapter; presentation belongs in Renderer code. */
    notification: DesktopSessionNotification
  }

declare global {
  interface Window {
    /** Installed by the context-isolated preload. */
    dshDesktop: DesktopBridge
  }
}
