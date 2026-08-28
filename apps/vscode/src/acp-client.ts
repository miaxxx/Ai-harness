/**
 * VS Code product controller over the shared ACP subprocess transport.
 *
 * It owns only the extension's active presentation session. Durable identity,
 * replay, Agent execution, tools, permissions, and sandboxing remain Runtime
 * responsibilities reached through standard ACP methods.
 */

import type { ListSessionsResponse, PromptResponse } from '@agentclientprotocol/sdk'
import {
  connectAcpRuntime,
  type AcpClientHandlers,
  type AcpRuntimeConnection,
  type AcpRuntimeSpec,
} from '@deepseek-ai/dsh-acp-client'

/** One extension-host ACP client with at most one UI-active Session. */
export class VscodeAcpClient {
  private runtime: AcpRuntimeConnection | undefined
  private connecting: Promise<AcpRuntimeConnection> | undefined
  private activeId: string | undefined
  private disposed = false

  /**
   * Create a product client for one replaceable Runtime process.
   * @param spec - Runtime process selected by extension configuration.
   * @param handlers - VS Code presentation and permission callbacks.
   */
  constructor(
    private readonly spec: AcpRuntimeSpec,
    private readonly handlers: AcpClientHandlers,
  ) {}

  /** Session currently loaded for VS Code presentation, if any. */
  get activeSessionId(): string | undefined {
    return this.activeId
  }

  private async connection(): Promise<AcpRuntimeConnection> {
    if (this.disposed) throw new Error('VS Code ACP client has been disposed')
    if (this.runtime !== undefined) return this.runtime
    this.connecting ??= connectAcpRuntime(this.spec, this.handlers)
    try {
      const runtime = await this.connecting
      this.runtime = runtime
      return runtime
    } finally {
      this.connecting = undefined
    }
  }

  /**
   * List durable top-level Sessions for one workspace.
   * @param cwd - Absolute VS Code workspace root.
   * @returns Standard ACP list response.
   */
  async listSessions(cwd: string): Promise<ListSessionsResponse> {
    const runtime = await this.connection()
    return runtime.client.listSessions({ cwd })
  }

  /**
   * Create and activate a fresh durable Session.
   * @param cwd - Absolute VS Code workspace root.
   * @returns The ACP Session id.
   */
  async createSession(cwd: string): Promise<string> {
    await this.closeActiveSession()
    const runtime = await this.connection()
    const created = await runtime.client.newSession({ cwd, mcpServers: [] })
    this.activeId = created.sessionId
    return created.sessionId
  }

  /**
   * Load a durable Session and replay its presentation updates into VS Code.
   * @param sessionId - Persisted ACP Session id selected by the user.
   * @param cwd - Absolute workspace root that owns the Session.
   */
  async loadSession(sessionId: string, cwd: string): Promise<void> {
    if (this.activeId === sessionId) return
    await this.closeActiveSession()
    const runtime = await this.connection()
    await runtime.client.loadSession({ sessionId, cwd, mcpServers: [] })
    this.activeId = sessionId
  }

  /**
   * Prompt the currently active Session.
   * @param text - User prompt text from VS Code.
   * @returns Standard ACP prompt response.
   */
  async prompt(text: string): Promise<PromptResponse> {
    if (this.activeId === undefined) throw new Error('No active DeepSeek Harness Session')
    const runtime = await this.connection()
    return runtime.client.prompt({
      sessionId: this.activeId,
      prompt: [{ type: 'text', text }],
    })
  }

  /** Release the live active Session without deleting its durable log. */
  async closeActiveSession(): Promise<void> {
    if (this.activeId === undefined) return
    const runtime = await this.connection()
    const sessionId = this.activeId
    await runtime.client.closeSession({ sessionId })
    if (this.activeId === sessionId) this.activeId = undefined
  }

  /** Close the active Session and prove the owned Runtime subprocess exited. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    let runtime = this.runtime
    if (runtime === undefined && this.connecting !== undefined) {
      runtime = await this.connecting.catch(() => undefined)
    }
    if (runtime !== undefined && this.activeId !== undefined) {
      const sessionId = this.activeId
      try {
        await runtime.client.closeSession({ sessionId })
      } finally {
        this.activeId = undefined
      }
    }
    this.disposed = true
    this.runtime = undefined
    if (runtime !== undefined) await runtime.dispose()
  }
}
