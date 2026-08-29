import type { AcpClientHandlers } from '@deepseek-ai/dsh-acp-client'

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
}

/** Structured ACP Session notification forwarded without presentation loss. */
export type DesktopSessionNotification = Parameters<AcpClientHandlers['onSessionUpdate']>[0]

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
  prompt(sessionId: string, text: string): Promise<DesktopPromptResult>
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
