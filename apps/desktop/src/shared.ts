/** Durable Session metadata safe to expose to the sandboxed Renderer. */
export interface DesktopSessionSummary {
  sessionId: string
  cwd: string
  title?: string
}

/** Result of one ACP prompt turn. */
export interface DesktopPromptResult {
  stopReason: string
}

/** Low-authority API exposed by the context-isolated preload. */
export interface DesktopBridge {
  /** Workspace whose durable ACP Sessions the Desktop Runtime owns. */
  workspace(): Promise<string>
  /** List durable Sessions for the Desktop workspace. */
  listSessions(): Promise<DesktopSessionSummary[]>
  /** Create one fresh durable Session. */
  createSession(): Promise<string>
  /** Restore one durable Session and replay its presentation updates. */
  loadSession(sessionId: string): Promise<void>
  /** Prompt one live Session through ACP. */
  prompt(sessionId: string, text: string): Promise<DesktopPromptResult>
  /** Cancel the current turn for one live Session. */
  cancel(sessionId: string): void
  /** Release one live Session while retaining durable history. */
  closeSession(sessionId: string): Promise<void>
  /** Subscribe to Runtime lifecycle and ACP presentation updates. */
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
    text: string
  }

declare global {
  interface Window {
    /** Installed by the context-isolated preload. */
    dshDesktop: DesktopBridge
  }
}
