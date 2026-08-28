/**
 * Electron main process: secure window/resource ownership, typed Renderer IPC,
 * and lifecycle supervision for one standalone ACP Runtime subprocess.
 */

import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, Menu, protocol,
} from 'electron'
import {
  connectAcpRuntime,
  type AcpClientHandlers,
  type AcpRuntimeConnection,
  type AcpRuntimeSpec,
} from '@deepseek-ai/dsh-acp-client'
import type {
  DesktopPromptResult,
  DesktopRendererFrame,
  DesktopSessionSummary,
} from './shared.ts'

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}])

const APP_ORIGIN = 'dsh-app://app'
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const ACP_RUNTIME_BIN = resolve(REPOSITORY_ROOT, 'packages/examples/acp-demo/lib/bin.js')
const ACP_RUNTIME_CONFIG = resolve(REPOSITORY_ROOT, 'examples/acp-agent/cordis.yml')
const DESKTOP_WORKSPACE = resolve(process.env.DSH_DESKTOP_WORKSPACE ?? REPOSITORY_ROOT)
const RENDERER_ROOT = resolve(fileURLToPath(new URL('./renderer/', import.meta.url)))

type PermissionRequest = Parameters<NonNullable<AcpClientHandlers['onPermissionRequest']>>[0]
type SessionNotification = Parameters<AcpClientHandlers['onSessionUpdate']>[0]

function parseRuntimeArgs(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('DSH_DESKTOP_ACP_ARGS_JSON must be a JSON array of strings')
  }
  return parsed
}

function desktopRuntimeSpec(): AcpRuntimeSpec {
  const command = process.env.DSH_DESKTOP_ACP_COMMAND
  if (command !== undefined && command.trim().length > 0) {
    return {
      command,
      args: parseRuntimeArgs(process.env.DSH_DESKTOP_ACP_ARGS_JSON),
      cwd: DESKTOP_WORKSPACE,
    }
  }
  return {
    command: process.env.DSH_DESKTOP_NODE ?? process.env.npm_node_execpath ?? 'node',
    args: [ACP_RUNTIME_BIN, '--config', ACP_RUNTIME_CONFIG],
    cwd: DESKTOP_WORKSPACE,
  }
}

function permissionLabel(kind: PermissionRequest['options'][number]['kind']): string {
  switch (kind) {
    case 'allow_once': return 'Allow once'
    case 'allow_always': return 'Allow always'
    case 'reject_once': return 'Reject'
    case 'reject_always': return 'Always reject'
    default: return kind
  }
}

function renderSessionUpdate(notification: SessionNotification): DesktopRendererFrame | undefined {
  const update = notification.update
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return update.content.type === 'text'
        ? { type: 'session-update', sessionId: notification.sessionId, text: `user> ${update.content.text}` }
        : undefined
    case 'agent_message_chunk':
      return update.content.type === 'text'
        ? { type: 'session-update', sessionId: notification.sessionId, text: `assistant> ${update.content.text}` }
        : undefined
    case 'tool_call':
      return {
        type: 'session-update',
        sessionId: notification.sessionId,
        text: `[tool ${update.toolCallId}] ${update.title} — ${update.status}`,
      }
    case 'tool_call_update':
      return {
        type: 'session-update',
        sessionId: notification.sessionId,
        text: `[tool ${update.toolCallId}] ${update.status}`,
      }
    case 'plan':
      return {
        type: 'session-update',
        sessionId: notification.sessionId,
        text: update.entries.map(entry => `[plan:${entry.status}] ${entry.content}`).join('\n'),
      }
    default:
      return undefined
  }
}

class AcpRuntimeSupervisor {
  private connection: AcpRuntimeConnection | undefined
  private connecting: Promise<AcpRuntimeConnection> | undefined
  private window: BrowserWindow | undefined

  attachWindow(window: BrowserWindow): void {
    this.window = window
  }

  running(): boolean {
    return this.connection !== undefined || this.connecting !== undefined
  }

  private publish(frame: DesktopRendererFrame): void {
    this.window?.webContents.send('dsh:frame', frame)
  }

  private publishStatus(
    status: Extract<DesktopRendererFrame, { type: 'runtime-status' }>['status'],
    message?: string,
  ): void {
    this.publish({
      type: 'runtime-status',
      status,
      ...(message === undefined ? {} : { message }),
    })
  }

  private async requestPermission(request: PermissionRequest): Promise<ReturnType<NonNullable<AcpClientHandlers['onPermissionRequest']>> extends Promise<infer R> ? R : never> {
    const window = this.window
    if (window === undefined || request.options.length === 0) {
      return { outcome: { outcome: 'cancelled' } }
    }
    const buttons = request.options.map(option => permissionLabel(option.kind))
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      message: `DeepSeek Harness requests permission for tool call ${request.toolCall.toolCallId}`,
      detail: 'Permission decides whether this action should run. Runtime sandbox policy independently constrains what it can access.',
      buttons,
      cancelId: Math.max(0, request.options.findIndex(option => option.kind.startsWith('reject_'))),
      noLink: true,
    })
    const option = request.options[result.response]
    return option === undefined
      ? { outcome: { outcome: 'cancelled' } }
      : { outcome: { outcome: 'selected', optionId: option.optionId } }
  }

  async start(): Promise<void> {
    if (this.connection !== undefined) return
    if (this.connecting !== undefined) {
      await this.connecting
      return
    }
    this.publishStatus('starting')
    const pending = connectAcpRuntime(desktopRuntimeSpec(), {
      onSessionUpdate: notification => {
        const frame = renderSessionUpdate(notification)
        if (frame !== undefined) this.publish(frame)
      },
      onPermissionRequest: request => this.requestPermission(request),
      onRuntimeStderr: text => { process.stderr.write(`[desktop-runtime] ${text}`) },
    })
    this.connecting = pending
    try {
      const connection = await pending
      this.connection = connection
      this.publishStatus('ready')
      void connection.client.closed.then(() => {
        if (this.connection !== connection) return
        this.connection = undefined
        this.publishStatus('failed', 'ACP Runtime connection closed unexpectedly')
      })
    } catch (error: unknown) {
      this.publishStatus('failed', error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      if (this.connecting === pending) this.connecting = undefined
    }
  }

  async stop(): Promise<void> {
    if (this.connection === undefined && this.connecting !== undefined) {
      await this.connecting.catch(() => {})
    }
    const connection = this.connection
    this.connection = undefined
    this.connecting = undefined
    if (connection === undefined) {
      this.publishStatus('stopped')
      return
    }
    await connection.dispose()
    this.publishStatus('stopped')
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  private async runtime(): Promise<AcpRuntimeConnection> {
    await this.start()
    if (this.connection === undefined) throw new Error('ACP Runtime is not available')
    return this.connection
  }

  workspace(): string {
    return DESKTOP_WORKSPACE
  }

  async listSessions(): Promise<DesktopSessionSummary[]> {
    const runtime = await this.runtime()
    const result = await runtime.client.listSessions({ cwd: DESKTOP_WORKSPACE })
    return result.sessions.map(session => ({
      sessionId: session.sessionId,
      cwd: session.cwd,
      ...(session.title === undefined ? {} : { title: session.title }),
    }))
  }

  async createSession(): Promise<string> {
    const runtime = await this.runtime()
    const created = await runtime.client.newSession({ cwd: DESKTOP_WORKSPACE, mcpServers: [] })
    return created.sessionId
  }

  async loadSession(sessionId: string): Promise<void> {
    const runtime = await this.runtime()
    await runtime.client.loadSession({ sessionId, cwd: DESKTOP_WORKSPACE, mcpServers: [] })
  }

  async prompt(sessionId: string, text: string): Promise<DesktopPromptResult> {
    const runtime = await this.runtime()
    const result = await runtime.client.prompt({
      sessionId,
      prompt: [{ type: 'text', text }],
    })
    return { stopReason: result.stopReason }
  }

  cancel(sessionId: string): void {
    void this.runtime()
      .then(runtime => runtime.client.cancel({ sessionId }))
      .catch(error => {
        this.publishStatus('failed', error instanceof Error ? error.message : String(error))
      })
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = await this.runtime()
    await runtime.client.closeSession({ sessionId })
  }
}

const supervisor = new AcpRuntimeSupervisor()

function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function installIpc(): void {
  ipcMain.handle('dsh:workspace', (event) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return supervisor.workspace()
  })
  ipcMain.handle('dsh:session-list', async (event) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return supervisor.listSessions()
  })
  ipcMain.handle('dsh:session-create', async (event) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return supervisor.createSession()
  })
  ipcMain.handle('dsh:session-load', async (event, value: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    await supervisor.loadSession(nonEmptyString(value, 'sessionId'))
  })
  ipcMain.handle('dsh:session-prompt', async (event, rawSessionId: unknown, rawText: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return supervisor.prompt(
      nonEmptyString(rawSessionId, 'sessionId'),
      nonEmptyString(rawText, 'prompt'),
    )
  })
  ipcMain.on('dsh:session-cancel', (event, value: unknown) => {
    if (trustedSender(event) && typeof value === 'string' && value.length > 0) supervisor.cancel(value)
  })
  ipcMain.handle('dsh:session-close', async (event, value: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    await supervisor.closeSession(nonEmptyString(value, 'sessionId'))
  })
  ipcMain.handle('dsh:runtime-restart', async (event) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    await supervisor.restart()
  })
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
}

function installResourceProtocol(): void {
  protocol.handle('dsh-app', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app' || request.method !== 'GET') return new Response('not found', { status: 404 })
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const path = resolve(RENDERER_ROOT, relative)
    if (path !== RENDERER_ROOT && !path.startsWith(RENDERER_ROOT + sep)) return new Response('forbidden', { status: 403 })
    try {
      const body = await readFile(path)
      return new Response(body, {
        headers: {
          'content-type': MIME[extname(path)] ?? 'application/octet-stream',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: 'DeepSeek Harness Desktop Preview',
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!app.isPackaged) {
    window.webContents.on('console-message', (_event, _level, message) => {
      process.stderr.write(`[desktop-renderer] ${message}\n`)
    })
  }
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault()
  })
  supervisor.attachWindow(window)
  await window.loadURL(`${APP_ORIGIN}/index.html`)
  return window
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  await app.whenReady()
  installResourceProtocol()
  installIpc()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]))
  const window = await createWindow()
  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  void supervisor.start().catch(() => {})
}

app.on('before-quit', (event) => {
  if (!supervisor.running()) return
  event.preventDefault()
  void supervisor.stop().finally(() => { app.quit() })
})
app.on('window-all-closed', () => { app.quit() })

void main()
