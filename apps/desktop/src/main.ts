/**
 * Electron main process: secure window/resource ownership, typed Renderer IPC,
 * and lifecycle supervision for one standalone ACP Runtime subprocess.
 */

import { mkdir, readFile, readdir } from 'node:fs/promises'
import {
  basename, dirname, extname, isAbsolute, join, parse, resolve, sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell,
} from 'electron'
import {
  connectAcpRuntime,
  type AcpClientHandlers,
  type AcpRuntimeConnection,
  type AcpRuntimeSpec,
} from '@deepseek-ai/dsh-acp-client'
import type {
  DesktopDirectoryCrumb,
  DesktopDirectoryListing,
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
const RENDERER_ROOT = resolve(fileURLToPath(new URL('./renderer/', import.meta.url)))
const DIRECTORY_LIST_LIMIT = 500

function packagedRuntimePath(...parts: string[]): string {
  return join(process.resourcesPath, 'runtime', ...parts)
}

function desktopWorkspace(): string {
  return resolve(process.env.DSH_DESKTOP_WORKSPACE ?? (app.isPackaged ? app.getPath('home') : REPOSITORY_ROOT))
}

function workspacePath(value: unknown): string {
  if (value === undefined || value === null || value === '') return desktopWorkspace()
  const raw = nonEmptyString(value, 'cwd')
  if (!isAbsolute(raw)) throw new Error('cwd must be an absolute path')
  return resolve(raw)
}

type PermissionRequest = Parameters<NonNullable<AcpClientHandlers['onPermissionRequest']>>[0]

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
}

function parseRuntimeArgs(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return []
  const parsed: unknown = JSON.parse(value)
  if (!isStringArray(parsed)) {
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
      cwd: desktopWorkspace(),
    }
  }
  if (app.isPackaged) {
    return {
      command: packagedRuntimePath('node', 'bin', 'node'),
      args: [
        packagedRuntimePath('app', 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js'),
        '--config',
        packagedRuntimePath('app', 'cordis.yml'),
      ],
      cwd: desktopWorkspace(),
    }
  }
  return {
    command: process.env.DSH_DESKTOP_NODE ?? process.env.npm_node_execpath ?? 'node',
    args: [
      resolve(REPOSITORY_ROOT, 'packages/examples/acp-demo/lib/bin.js'),
      '--config',
      resolve(REPOSITORY_ROOT, 'examples/acp-agent/cordis.yml'),
    ],
    cwd: desktopWorkspace(),
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

function directoryCrumbs(path: string): DesktopDirectoryCrumb[] {
  const parsed = parse(path)
  const crumbs: DesktopDirectoryCrumb[] = []
  let current = parsed.root
  if (current !== '') {
    crumbs.push({ name: parsed.root, path: parsed.root, hidden: false })
  }
  const relative = path.slice(parsed.root.length)
  for (const segment of relative.split(sep).filter(Boolean)) {
    current = current === '' ? segment : join(current, segment)
    crumbs.push({ name: segment, path: current, hidden: segment.startsWith('.') })
  }
  return crumbs
}

async function listDirectory(value: unknown): Promise<DesktopDirectoryListing> {
  const home = app.getPath('home')
  const path = value === undefined || value === null || value === ''
    ? home
    : workspacePath(value)
  const children = await readdir(path, { withFileTypes: true })
  const visible = children
    .filter(entry => entry.isDirectory() || entry.isFile())
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name)
    })
  const truncated = visible.length > DIRECTORY_LIST_LIMIT
  return {
    path,
    home,
    crumbs: directoryCrumbs(path),
    entries: visible.slice(0, DIRECTORY_LIST_LIMIT).map(entry => ({
      name: entry.name,
      path: join(path, entry.name),
      kind: entry.isDirectory() ? 'directory' : 'file',
      hidden: entry.name.startsWith('.'),
    })),
    truncated,
  }
}

function childDirectory(parentValue: unknown, nameValue: unknown): { parent: string; name: string; path: string } {
  const parent = workspacePath(parentValue)
  const name = nonEmptyString(nameValue, 'directory name').trim()
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('directory name must be one path segment')
  }
  return { parent, name, path: join(parent, name) }
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
      onSessionUpdate: (notification) => {
        this.publish({
          type: 'session-update',
          sessionId: notification.sessionId,
          notification,
        })
      },
      onPermissionRequest: request => this.requestPermission(request),
      onRuntimeStderr: (text) => { process.stderr.write(`[desktop-runtime] ${text}`) },
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
    return desktopWorkspace()
  }

  async listSessions(cwd = desktopWorkspace()): Promise<DesktopSessionSummary[]> {
    const runtime = await this.runtime()
    const result = await runtime.client.listSessions({ cwd })
    return result.sessions.map(session => ({
      sessionId: session.sessionId,
      cwd: session.cwd,
      ...(session.title === undefined || session.title === null ? {} : { title: session.title }),
    }))
  }

  async createSession(cwd = desktopWorkspace()): Promise<string> {
    const runtime = await this.runtime()
    const created = await runtime.client.newSession({ cwd, mcpServers: [] })
    return created.sessionId
  }

  async loadSession(sessionId: string, cwd = desktopWorkspace()): Promise<void> {
    const runtime = await this.runtime()
    await runtime.client.loadSession({ sessionId, cwd, mcpServers: [] })
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
      .catch((error: unknown) => {
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
  ipcMain.handle('dsh:session-list', async (event, rawCwd: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return supervisor.listSessions(workspacePath(rawCwd))
  })
  ipcMain.handle('dsh:session-create', async (event, rawCwd: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return supervisor.createSession(workspacePath(rawCwd))
  })
  ipcMain.handle('dsh:session-load', async (event, rawSessionId: unknown, rawCwd: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    await supervisor.loadSession(nonEmptyString(rawSessionId, 'sessionId'), workspacePath(rawCwd))
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
  ipcMain.handle('dsh:directory-pick', async (event) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window ?? undefined, {
      defaultPath: desktopWorkspace(),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('dsh:directory-list', async (event, value: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return listDirectory(value)
  })
  ipcMain.handle('dsh:directory-create', async (event, rawParent: unknown, rawName: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    const child = childDirectory(rawParent, rawName)
    await mkdir(child.path)
    return child.path
  })
  ipcMain.handle('dsh:path-open', async (event, value: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    const path = workspacePath(value)
    const error = await shell.openPath(path)
    if (error !== '') throw new Error(error)
  })
  ipcMain.handle('dsh:runtime-restart', async (event) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    await supervisor.restart()
  })
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
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
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: 'DeepSeek Harness',
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
  const runtimeStart = supervisor.start()
  if (process.env.DSH_DESKTOP_DIST_SMOKE === '1') {
    void runtimeStart
      .then(() => supervisor.listSessions())
      .then(() => {
        process.stderr.write('desktop-dist-smoke: ready\n')
        app.quit()
      })
      .catch((error: unknown) => {
        process.stderr.write(`desktop-dist-smoke: ${error instanceof Error ? error.message : String(error)}\n`)
        app.exit(1)
      })
  } else {
    void runtimeStart.catch(() => {})
  }
}

app.on('before-quit', (event) => {
  if (!supervisor.running()) return
  event.preventDefault()
  void supervisor.stop().finally(() => { app.quit() })
})
app.on('window-all-closed', () => { app.quit() })

void main()
