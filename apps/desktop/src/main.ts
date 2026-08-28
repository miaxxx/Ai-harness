/**
 * Electron main process: secure window/resource ownership, strict Renderer
 * IPC, and lifecycle supervision for the independent Node Agent Host.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import {
  app, BrowserWindow, ipcMain, Menu, protocol,
} from 'electron'
import {
  parseStdioFetchClientFrame,
  parseStdioFetchServerFrame,
  STDIO_FETCH_PROTOCOL_VERSION,
  type StdioFetchRequestFrame,
  type StdioFetchServerFrame,
} from '@deepseek-ai/dsh-host-apiproxy/stdio-protocol'
import type { DesktopFetchResponse, DesktopRendererFrame } from './shared.ts'

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}])

const APP_ORIGIN = 'dsh-app://app'
const HOST_START_TIMEOUT_MS = 20_000
const HOST_STOP_TIMEOUT_MS = 5_000
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const HOST_PATCH = resolve(REPOSITORY_ROOT, 'apps/desktop/host.patch.yml')
const CLI_SOURCE = resolve(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const RENDERER_ROOT = resolve(fileURLToPath(new URL('./renderer/', import.meta.url)))

interface PendingRequest {
  sender: Electron.WebContents
  resolve(response: DesktopFetchResponse): void
  reject(error: Error): void
  responded: boolean
  resumed: boolean
  terminal: boolean
  buffered: DesktopRendererFrame[]
}

class AgentHostSupervisor {
  private child: ChildProcessWithoutNullStreams | undefined
  private ready: Promise<void> | undefined
  private readonly pending = new Map<string, PendingRequest>()
  private window: BrowserWindow | undefined

  attachWindow(window: BrowserWindow): void {
    this.window = window
  }

  running(): boolean {
    return this.child !== undefined
  }

  async start(): Promise<void> {
    if (this.child !== undefined) return this.ready
    this.publishStatus('starting')
    const node = process.env.DSH_DESKTOP_NODE ?? process.env.npm_node_execpath ?? 'node'
    const child = spawn(node, [
      '--import', 'tsx/esm', CLI_SOURCE,
      '--profile', 'web', '--patch', HOST_PATCH,
    ], {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { process.stderr.write(`[desktop-host] ${chunk}`) })

    let settleReady!: () => void
    let rejectReady!: (error: Error) => void
    this.ready = new Promise<void>((resolveReady, reject) => {
      settleReady = resolveReady
      rejectReady = reject
    })
    const timeout = setTimeout(() => {
      rejectReady(new Error(`Agent Host did not complete its protocol handshake within ${String(HOST_START_TIMEOUT_MS)}ms`))
      child.kill('SIGTERM')
    }, HOST_START_TIMEOUT_MS)

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity, terminal: false })
    lines.on('line', (line) => {
      try {
        this.receive(parseStdioFetchServerFrame(JSON.parse(line) as unknown), settleReady, rejectReady, timeout)
      } catch (error: unknown) {
        rejectReady(new Error(`Agent Host emitted an invalid protocol frame: ${String(error)}`))
        child.kill('SIGTERM')
      }
    })
    child.once('error', (error) => { rejectReady(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      lines.close()
      const expected = this.child === undefined
      if (this.child === child) this.child = undefined
      this.ready = undefined
      const reason = `Agent Host exited (${code === null ? signal : `code ${String(code)}`})`
      for (const [id, request] of this.pending) {
        request.reject(new Error(reason))
        this.pending.delete(id)
      }
      this.publishStatus(expected ? 'stopped' : 'failed', expected ? undefined : reason)
    })
    this.write({ type: 'hello', version: STDIO_FETCH_PROTOCOL_VERSION })
    try {
      await this.ready
    } catch (error) {
      this.publishStatus('failed', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.child = undefined
    const exited = new Promise<void>((resolveExit) => { child.once('exit', () => { resolveExit() }) })
    child.stdin.end()
    child.kill('SIGTERM')
    const timer = setTimeout(() => { child.kill('SIGKILL') }, HOST_STOP_TIMEOUT_MS)
    await exited
    clearTimeout(timer)
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async request(sender: Electron.WebContents, value: unknown): Promise<DesktopFetchResponse> {
    await this.start()
    const frame = parseStdioFetchClientFrame(value)
    if (frame.type !== 'request') throw new Error('desktop IPC accepts request frames only')
    if (this.pending.has(frame.id)) throw new Error(`desktop request id ${JSON.stringify(frame.id)} is already active`)
    return new Promise<DesktopFetchResponse>((resolveResponse, reject) => {
      this.pending.set(frame.id, {
        sender, resolve: resolveResponse, reject, responded: false, resumed: false, terminal: false, buffered: [],
      })
      this.write(frame)
    })
  }

  resume(sender: Electron.WebContents, id: string): void {
    const request = this.pending.get(id)
    if (request === undefined || request.sender !== sender || request.resumed) return
    request.resumed = true
    for (const frame of request.buffered) request.sender.send('dsh:frame', frame)
    request.buffered.length = 0
    if (request.terminal) this.pending.delete(id)
  }

  cancel(sender: Electron.WebContents, id: string): void {
    const request = this.pending.get(id)
    if (request === undefined || request.sender !== sender) return
    this.write({ type: 'cancel', id })
  }

  private receive(
    frame: StdioFetchServerFrame,
    settleReady: () => void,
    rejectReady: (error: Error) => void,
    timeout: ReturnType<typeof setTimeout>,
  ): void {
    if (frame.type === 'ready') {
      clearTimeout(timeout)
      if (frame.version !== STDIO_FETCH_PROTOCOL_VERSION) {
        rejectReady(new Error(`Agent Host protocol version ${String(frame.version)} is incompatible`))
        return
      }
      settleReady()
      this.publishStatus('ready')
      return
    }
    if (frame.type === 'error' && frame.fatal) {
      rejectReady(new Error(frame.message))
      return
    }
    if (!('id' in frame) || frame.id === undefined) return
    const request = this.pending.get(frame.id)
    if (request === undefined) return
    if (frame.type === 'response') {
      request.responded = true
      request.resolve({ status: frame.status, statusText: frame.statusText, headers: frame.headers })
      return
    }
    if (frame.type === 'error' && !request.responded) {
      request.reject(new Error(frame.message))
      this.pending.delete(frame.id)
      return
    }
    const rendererFrame: DesktopRendererFrame = frame
    if (request.resumed) request.sender.send('dsh:frame', rendererFrame)
    else request.buffered.push(rendererFrame)
    if (frame.type === 'end' || frame.type === 'error') {
      request.terminal = true
      if (request.resumed) this.pending.delete(frame.id)
    }
  }

  private write(frame: object): void {
    const stdin = this.child?.stdin
    if (stdin === undefined || stdin.destroyed) throw new Error('Agent Host is not running')
    stdin.write(`${JSON.stringify(frame)}\n`)
  }

  private publishStatus(status: Extract<DesktopRendererFrame, { type: 'host-status' }>['status'], message?: string): void {
    this.window?.webContents.send('dsh:frame', {
      type: 'host-status', status, ...(message === undefined ? {} : { message }),
    } satisfies DesktopRendererFrame)
  }
}

const supervisor = new AgentHostSupervisor()

function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true
}

function installIpc(): void {
  ipcMain.handle('dsh:fetch-start', async (event, request: StdioFetchRequestFrame) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    return supervisor.request(event.sender, request)
  })
  ipcMain.on('dsh:fetch-resume', (event, id: unknown) => {
    if (trustedSender(event) && typeof id === 'string') supervisor.resume(event.sender, id)
  })
  ipcMain.on('dsh:fetch-cancel', (event, id: unknown) => {
    if (trustedSender(event) && typeof id === 'string') supervisor.cancel(event.sender, id)
  })
  ipcMain.handle('dsh:host-restart', async (event) => {
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
