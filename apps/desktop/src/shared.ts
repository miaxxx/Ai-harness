import type { StdioFetchRequestFrame, StdioFetchServerFrame } from '@deepseek-ai/dsh-host-apiproxy/stdio-protocol'

/** Metadata required to construct a Renderer-side WHATWG Response. */
export interface DesktopFetchResponse {
  status: number
  statusText: string
  headers: [string, string][]
}

/** Low-authority API exposed by the sandboxed preload. */
export interface DesktopBridge {
  /** Start one API request after the Agent Host handshake. */
  start(request: StdioFetchRequestFrame): Promise<DesktopFetchResponse>
  /** Allow buffered response-body frames to enter the Renderer. */
  resume(id: string): void
  /** Cancel one request without affecting either event stream. */
  cancel(id: string): void
  /** Subscribe to response-body, completion, error, and Host lifecycle frames. */
  subscribe(listener: (frame: DesktopRendererFrame) => void): () => void
  /** Restart the supervised Agent Host after a startup or runtime failure. */
  restartHost(): Promise<void>
}

/** Frames the main process may push into the Renderer. */
export type DesktopRendererFrame =
  | Extract<StdioFetchServerFrame, { type: 'data' | 'end' | 'error' }>
  | { type: 'host-status'; status: 'starting' | 'ready' | 'stopped' | 'failed'; message?: string }

declare global {
  interface Window {
    /** Installed by the context-isolated preload. */
    dshDesktop: DesktopBridge
  }
}
