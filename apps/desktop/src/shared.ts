import type { SessionNotification } from '@agentclientprotocol/sdk'

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
export interface DesktopDirectoryEntry {
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

/** One file staged for the next prompt inside the Session artifact directory. */
export interface DesktopAttachment {
  id: string
  name: string
  path: string
  mediaType: string
  kind: 'image' | 'file'
  size: number
}

/** One ordinary file captured as a durable output of a Session turn. */
export interface DesktopArtifact {
  name: string
  path: string
  relativePath: string
  mediaType: string
  size: number
}

/** OpenAI-compatible wire protocol selected for the Desktop primary model. */
export type DesktopModelProtocol = 'openai-completions' | 'openai-responses'

/** Redacted primary-model configuration safe to expose to the Renderer. */
export interface DesktopModelSettings {
  configured: boolean
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  apiKeyConfigured: boolean
  computerUseEnabled: boolean
}

/** Writable primary-model fields; an empty API key preserves the stored secret. */
export interface DesktopModelSettingsUpdate {
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  apiKey: string
  computerUseEnabled: boolean
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
  /** Prompt one live Session through ACP. */
  prompt(sessionId: string, text: string, attachmentIds?: readonly string[]): Promise<DesktopPromptResult>
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
  /** List effective bundled, project, and user Skills for a Workspace. */
  listSkills(cwd: string): Promise<DesktopSkillSummary[]>
  /** Import a Skill folder or SKILL.md through the native picker. */
  importSkill(): Promise<DesktopSkillSummary | null>
  /** Remove one user-owned Skill. */
  removeSkill(name: string): Promise<void>
  /** Pick and stage image or ordinary-file attachments for one Session. */
  pickAttachments(sessionId: string, cwd: string): Promise<DesktopAttachment[]>
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
