/**
 * IDE-side Session controller over the standard ACP client connection.
 *
 * This layer intentionally owns no Runtime internals. It can start a replaceable
 * Harness subprocess through dsh-acp-client and then speaks only ACP for
 * session list/load/new/prompt/close and permission/update delivery.
 */

import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import {
  connectAcpRuntime,
  type AcpClientHandlers,
  type AcpRuntimeConnection,
  type AcpRuntimeSpec,
} from '@deepseek-ai/dsh-acp-client'

/** IDE-owned presentation and human-interaction hooks. */
export interface IdeAcpHost {
  /** Receive live and replayed ACP updates unchanged. */
  onSessionUpdate(notification: SessionNotification): void | Promise<void>
  /** Ask the human to resolve one Runtime permission request. Omission fails closed in the transport. */
  requestPermission?(request: RequestPermissionRequest): Promise<RequestPermissionResponse>
  /** Surface Runtime diagnostics without contaminating the ACP stdout wire. */
  onRuntimeStderr?(text: string): void
}

/** The ACP methods the IDE is allowed to use. */
export type IdeAcpClient = Pick<
  AcpRuntimeConnection['client'],
  'listSessions' | 'loadSession' | 'newSession' | 'prompt' | 'closeSession'
>

/** Minimal process connection shape used to make the controller hermetic in tests. */
export interface IdeRuntimeConnection {
  client: IdeAcpClient
  dispose(): Promise<void>
}

/** Replaceable connection factory. Production uses dsh-acp-client; tests use a fake ACP peer. */
export type IdeRuntimeConnector = (
  spec: AcpRuntimeSpec,
  handlers: AcpClientHandlers,
) => Promise<IdeRuntimeConnection>

function handlersFor(host: IdeAcpHost): AcpClientHandlers {
  return {
    onSessionUpdate: notification => host.onSessionUpdate(notification),
    ...(host.requestPermission === undefined
      ? {}
      : { onPermissionRequest: request => host.requestPermission!(request) }),
    ...(host.onRuntimeStderr === undefined
      ? {}
      : { onRuntimeStderr: text => host.onRuntimeStderr!(text) }),
  }
}

/**
 * One IDE window's sequential ACP ownership boundary.
 *
 * P0 intentionally supports sequential hand-off, not two Harness processes
 * activating the same persisted Session at once. The controller therefore owns
 * at most one live Session and closes it before loading/creating another one.
 */
export class IdeAcpController {
  readonly #host: IdeAcpHost
  readonly #connect: IdeRuntimeConnector
  #runtime: IdeRuntimeConnection | undefined
  #activeSessionId: string | undefined

  constructor(host: IdeAcpHost, connect: IdeRuntimeConnector = connectAcpRuntime) {
    this.#host = host
    this.#connect = connect
  }

  /** Currently active ACP Session, if any. */
  get activeSessionId(): string | undefined {
    return this.#activeSessionId
  }

  /** Start and initialize the replaceable Runtime once for this IDE controller. */
  async start(spec: AcpRuntimeSpec): Promise<void> {
    if (this.#runtime !== undefined) return
    this.#runtime = await this.#connect(spec, handlersFor(this.#host))
  }

  #client(): IdeAcpClient {
    if (this.#runtime === undefined) throw new Error('IDE ACP Runtime is not connected')
    return this.#runtime.client
  }

  /** List durable Sessions scoped to the current workspace. */
  async listSessions(cwd: string): ReturnType<IdeAcpClient['listSessions']> {
    return this.#client().listSessions({ cwd })
  }

  /** Restore one durable Session and replay its presentation history through ACP updates. */
  async loadSession(sessionId: string, cwd: string): Promise<void> {
    await this.closeActiveSession()
    await this.#client().loadSession({ sessionId, cwd, mcpServers: [] })
    this.#activeSessionId = sessionId
  }

  /** Create a fresh durable Session in the current workspace. */
  async newSession(cwd: string): Promise<string> {
    await this.closeActiveSession()
    const created = await this.#client().newSession({ cwd, mcpServers: [] })
    this.#activeSessionId = created.sessionId
    return created.sessionId
  }

  /** Prompt the active Session through ACP only. */
  async prompt(text: string): ReturnType<IdeAcpClient['prompt']> {
    const sessionId = this.#activeSessionId
    if (sessionId === undefined) throw new Error('IDE has no active ACP Session')
    const prompt = text.trim()
    if (prompt.length === 0) throw new Error('IDE prompt must not be empty')
    return this.#client().prompt({ sessionId, prompt: [{ type: 'text', text: prompt }] })
  }

  /** Release the live AgentHandle without deleting durable persistence. */
  async closeActiveSession(): Promise<void> {
    const sessionId = this.#activeSessionId
    if (sessionId === undefined) return
    this.#activeSessionId = undefined
    await this.#client().closeSession({ sessionId })
  }

  /** Close the live Session first, then quiesce and exit the owned Runtime process. */
  async dispose(): Promise<void> {
    const runtime = this.#runtime
    if (runtime === undefined) return
    this.#runtime = undefined
    let closeError: unknown
    try {
      await this.closeActiveSession()
    } catch (error: unknown) {
      closeError = error
    }
    await runtime.dispose()
    if (closeError !== undefined) throw closeError
  }
}
