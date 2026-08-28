import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AcpRuntimeSpec } from '@deepseek-ai/dsh-acp-client'
import * as vscode from 'vscode'
import { IdeAcpController } from './controller.ts'

const CONFIG_SECTION = 'deepseekHarness'
const OUTPUT_NAME = 'DeepSeek Harness'

let controller: IdeAcpController | undefined
let output: vscode.OutputChannel | undefined

function workspaceCwd(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (folder === undefined) throw new Error('Open a workspace folder before starting DeepSeek Harness')
  return folder.uri.fsPath
}

function runtimeSpec(): AcpRuntimeSpec {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
  return {
    command: config.get('runtimeCommand', 'dsh-acp-demo'),
    args: config.get<readonly string[]>('runtimeArgs', []).slice(),
    cwd: workspaceCwd(),
  }
}

function renderUpdate(notification: SessionNotification): void {
  const channel = output
  if (channel === undefined) return
  const update = notification.update
  if (update.sessionUpdate === 'user_message_chunk' || update.sessionUpdate === 'agent_message_chunk') {
    if (update.content.type !== 'text') return
    const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'assistant'
    channel.appendLine(`${role}> ${update.content.text}`)
    return
  }
  if (update.sessionUpdate === 'tool_call') {
    channel.appendLine(`tool> ${update.title} [${update.toolCallId}]`)
    return
  }
  if (update.sessionUpdate === 'tool_call_update') {
    channel.appendLine(`tool-update> ${update.toolCallId}`)
    return
  }
  if (update.sessionUpdate === 'plan') {
    channel.appendLine(`plan> ${update.entries.map(entry => `${entry.status}: ${entry.content}`).join(' | ')}`)
  }
}

interface PermissionPick extends vscode.QuickPickItem {
  optionId: string
}

async function requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
  const items: PermissionPick[] = request.options.map(option => ({
    label: option.kind.replaceAll('_', ' '),
    description: option.optionId,
    detail: `Tool call ${request.toolCall.toolCallId}`,
    optionId: option.optionId,
  }))
  const selected = await vscode.window.showQuickPick(items, {
    title: 'DeepSeek Harness permission',
    placeHolder: 'Choose one ACP permission response',
  })
  if (selected === undefined) return { outcome: { outcome: 'cancelled' } }
  return { outcome: { outcome: 'selected', optionId: selected.optionId } }
}

function requireController(): IdeAcpController {
  if (controller === undefined) throw new Error('DeepSeek Harness extension is not active')
  return controller
}

async function ensureRuntime(): Promise<IdeAcpController> {
  const current = requireController()
  await current.start(runtimeSpec())
  return current
}

async function openSession(): Promise<void> {
  const current = await ensureRuntime()
  const cwd = workspaceCwd()
  const result = await current.listSessions(cwd)
  if (result.sessions.length === 0) {
    await vscode.window.showInformationMessage('No durable DeepSeek Harness sessions exist in this workspace')
    return
  }
  const items = result.sessions.map(session => ({
    label: session.title ?? session.sessionId,
    description: session.sessionId,
    detail: session.cwd,
    sessionId: session.sessionId,
  }))
  const selected = await vscode.window.showQuickPick(items, {
    title: 'Open durable DeepSeek Harness session',
    placeHolder: 'Sessions are loaded through ACP and replayed from persistence',
  })
  if (selected === undefined) return
  output?.show(true)
  await current.loadSession(selected.sessionId, cwd)
  output?.appendLine(`[session ${selected.sessionId} loaded]`)
}

async function newSession(): Promise<void> {
  const current = await ensureRuntime()
  const sessionId = await current.newSession(workspaceCwd())
  output?.show(true)
  output?.appendLine(`[session ${sessionId} created]`)
}

async function prompt(): Promise<void> {
  const current = await ensureRuntime()
  if (current.activeSessionId === undefined) await current.newSession(workspaceCwd())
  const text = await vscode.window.showInputBox({
    prompt: 'Prompt the active DeepSeek Harness session through ACP',
    placeHolder: 'Describe the task…',
    ignoreFocusOut: true,
  })
  if (text === undefined || text.trim().length === 0) return
  output?.show(true)
  const result = await current.prompt(text)
  output?.appendLine(`[turn stopped: ${result.stopReason}]`)
}

async function closeSession(): Promise<void> {
  const current = requireController()
  const sessionId = current.activeSessionId
  await current.closeActiveSession()
  if (sessionId !== undefined) output?.appendLine(`[session ${sessionId} closed; durable history retained]`)
}

function command(callback: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await callback()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      output?.appendLine(`[error] ${message}`)
      await vscode.window.showErrorMessage(`DeepSeek Harness: ${message}`)
    }
  }
}

/** Activate the thin VS Code ACP product client. */
export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel(OUTPUT_NAME)
  controller = new IdeAcpController({
    onSessionUpdate: renderUpdate,
    requestPermission,
    onRuntimeStderr(text) {
      output?.append(text)
    },
  })

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('deepseekHarness.openSession', command(openSession)),
    vscode.commands.registerCommand('deepseekHarness.newSession', command(newSession)),
    vscode.commands.registerCommand('deepseekHarness.prompt', command(prompt)),
    vscode.commands.registerCommand('deepseekHarness.closeSession', command(closeSession)),
    vscode.commands.registerCommand('deepseekHarness.showOutput', () => output?.show(false)),
  )
}

/** Release live ACP resources without deleting persisted Sessions. */
export async function deactivate(): Promise<void> {
  const current = controller
  controller = undefined
  try {
    await current?.dispose()
  } finally {
    output?.dispose()
    output = undefined
  }
}
