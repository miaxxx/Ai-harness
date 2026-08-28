import * as vscode from 'vscode'
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AcpRuntimeSpec } from '@deepseek-ai/dsh-acp-client'
import { VscodeAcpClient } from './acp-client.ts'

interface ActiveClient {
  cwd: string
  client: VscodeAcpClient
}

function permissionLabel(kind: RequestPermissionRequest['options'][number]['kind']): string {
  switch (kind) {
    case 'allow_once': return 'Allow once'
    case 'allow_always': return 'Allow always'
    case 'reject_once': return 'Reject'
    case 'reject_always': return 'Always reject'
    default: return kind
  }
}

function renderUpdate(notification: SessionNotification): string | undefined {
  const update = notification.update
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return update.content.type === 'text' ? `user> ${update.content.text}` : undefined
    case 'agent_message_chunk':
      return update.content.type === 'text' ? `assistant> ${update.content.text}` : undefined
    case 'tool_call':
      return `[tool ${update.toolCallId}] ${update.title} — ${update.status}`
    case 'tool_call_update':
      return `[tool ${update.toolCallId}] ${update.status}`
    case 'plan':
      return update.entries.map(entry => `[plan:${entry.status}] ${entry.content}`).join('\n')
    default:
      return undefined
  }
}

class ExtensionHost implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('DeepSeek Harness')
  private active: ActiveClient | undefined
  private disposing: Promise<void> | undefined

  private workspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders
    if (folders === undefined || folders.length === 0) {
      throw new Error('Open a VS Code workspace before using DeepSeek Harness')
    }
    return folders[0]!.uri.fsPath
  }

  private runtimeSpec(cwd: string): AcpRuntimeSpec {
    const config = vscode.workspace.getConfiguration('dsh')
    const command = config.get<string>('runtimeCommand')
    if (command === undefined || command.trim().length === 0) {
      throw new Error('Configure dsh.runtimeCommand with a standalone ACP Runtime executable')
    }
    return {
      command,
      args: config.get<string[]>('runtimeArgs') ?? [],
      cwd,
    }
  }

  private async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const choices = request.options.map((option, index) => ({
      label: `${permissionLabel(option.kind)}${request.options.length > 1 ? ` (${index + 1})` : ''}`,
      optionId: option.optionId,
    }))
    const selected = await vscode.window.showWarningMessage(
      `DeepSeek Harness requests permission for tool call ${request.toolCall.toolCallId}`,
      { modal: true },
      ...choices.map(choice => choice.label),
    )
    if (selected === undefined) return { outcome: { outcome: 'cancelled' } }
    const choice = choices.find(candidate => candidate.label === selected)
    if (choice === undefined) return { outcome: { outcome: 'cancelled' } }
    return { outcome: { outcome: 'selected', optionId: choice.optionId } }
  }

  private async clientForWorkspace(): Promise<VscodeAcpClient> {
    const cwd = this.workspaceRoot()
    if (this.active?.cwd === cwd) return this.active.client
    await this.active?.client.dispose()
    const client = new VscodeAcpClient(this.runtimeSpec(cwd), {
      onSessionUpdate: notification => {
        const rendered = renderUpdate(notification)
        if (rendered !== undefined) this.output.appendLine(rendered)
      },
      onPermissionRequest: request => this.requestPermission(request),
      onRuntimeStderr: text => {
        for (const line of text.split(/\r?\n/u)) {
          if (line.length > 0) this.output.appendLine(`[runtime] ${line}`)
        }
      },
    })
    this.active = { cwd, client }
    return client
  }

  async createSession(): Promise<void> {
    const client = await this.clientForWorkspace()
    this.output.clear()
    this.output.show(true)
    const sessionId = await client.createSession(this.workspaceRoot())
    this.output.appendLine(`[session ${sessionId}]`)
    void vscode.window.showInformationMessage(`DeepSeek Harness Session ${sessionId} is active`)
  }

  async openSession(): Promise<void> {
    const cwd = this.workspaceRoot()
    const client = await this.clientForWorkspace()
    const result = await client.listSessions(cwd)
    if (result.sessions.length === 0) {
      void vscode.window.showInformationMessage('No durable DeepSeek Harness Sessions found for this workspace')
      return
    }
    const selected = await vscode.window.showQuickPick(
      result.sessions.map(session => ({
        label: session.title ?? session.sessionId,
        description: session.sessionId,
        sessionId: session.sessionId,
      })),
      { placeHolder: 'Select a durable DeepSeek Harness Session' },
    )
    if (selected === undefined) return
    this.output.clear()
    this.output.show(true)
    await client.loadSession(selected.sessionId, cwd)
    this.output.appendLine(`[session ${selected.sessionId}]`)
  }

  async prompt(): Promise<void> {
    const client = await this.clientForWorkspace()
    if (client.activeSessionId === undefined) {
      void vscode.window.showWarningMessage('Create or open a DeepSeek Harness Session first')
      return
    }
    const text = await vscode.window.showInputBox({
      prompt: `Prompt Session ${client.activeSessionId}`,
      ignoreFocusOut: true,
    })
    if (text === undefined || text.trim().length === 0) return
    this.output.show(true)
    const result = await client.prompt(text.trim())
    this.output.appendLine(`[stop ${result.stopReason}]`)
  }

  async closeSession(): Promise<void> {
    const client = await this.clientForWorkspace()
    const sessionId = client.activeSessionId
    if (sessionId === undefined) return
    await client.closeActiveSession()
    this.output.appendLine(`[closed ${sessionId}; durable history retained]`)
  }

  dispose(): void {
    this.disposing ??= (async () => {
      const client = this.active?.client
      this.active = undefined
      await client?.dispose()
      this.output.dispose()
    })()
  }

  /** Async extension shutdown used by `deactivate`. */
  async whenDisposed(): Promise<void> {
    this.dispose()
    await this.disposing
  }
}

let host: ExtensionHost | undefined

/** Activate the ACP-only VS Code product client. */
export function activate(context: vscode.ExtensionContext): void {
  host = new ExtensionHost()
  const command = (name: string, action: () => Promise<void>): vscode.Disposable =>
    vscode.commands.registerCommand(name, async () => {
      try {
        await action()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        void vscode.window.showErrorMessage(`DeepSeek Harness: ${message}`)
      }
    })
  context.subscriptions.push(
    host,
    command('dsh.createSession', () => host!.createSession()),
    command('dsh.openSession', () => host!.openSession()),
    command('dsh.prompt', () => host!.prompt()),
    command('dsh.closeSession', () => host!.closeSession()),
  )
}

/** Quiesce the active ACP Runtime when the extension host shuts down. */
export async function deactivate(): Promise<void> {
  const current = host
  host = undefined
  await current?.whenDisposed()
}
