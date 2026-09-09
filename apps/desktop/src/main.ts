/**
 * Electron main process: secure window/resource ownership, typed Renderer IPC,
 * and lifecycle supervision for one standalone ACP Runtime subprocess.
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, safeStorage, shell,
} from 'electron'
import {
  connectAcpRuntime,
  type AcpClientHandlers,
  type AcpRuntimeConnection,
  type AcpRuntimeSpec,
} from '@deepseek-ai/dsh-acp-client'
import type { ContentBlock } from '@agentclientprotocol/sdk'
import {
  parseUserMcpServer,
  readUserMcpServers,
  removeUserMcpServer,
  summarizeUserMcpServer,
  upsertUserMcpServer,
  type UserMcpServer,
} from '@deepseek-ai/dsh-mcp-user-config'
import type {
  DesktopDirectoryCrumb,
  DesktopDirectoryListing,
  DesktopAttachmentPaste,
  DesktopMcpServerSummary,
  DesktopMcpServerUpdate,
  DesktopModelProtocol,
  DesktopModelSettings,
  DesktopModelSettingsUpdate,
  DesktopWebSearchSettings,
  DesktopWebSearchSettingsUpdate,
  DesktopPromptResult,
  DesktopRendererFrame,
  DesktopSessionSummary,
} from './shared.ts'
import { desktopMediaType, DesktopContentStore } from './desktop-content.ts'
import type { DesktopPromptPart } from './desktop-prompt.ts'
import { probeDesktopModel } from './desktop-model-capabilities.ts'
import {
  MODEL_SETTINGS_VERSION,
  parseStoredModelSettings,
  type StoredModelSettings,
} from './desktop-model-storage.ts'
import {
  WEB_SEARCH_SETTINGS_VERSION,
  parseStoredWebSearchSettings,
  type StoredWebSearchSettings,
} from './desktop-web-search-storage.ts'
import {
  assertEnterpriseSessionAccess,
  claimEnterpriseSession,
  enterpriseRuntimeScope,
  filterEnterpriseSessions,
} from './desktop-enterprise-scope-main.ts'

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}])

const APP_ORIGIN = 'dsh-app://app'
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const RENDERER_ROOT = resolve(fileURLToPath(new URL('./renderer/', import.meta.url)))
const DIRECTORY_LIST_LIMIT = 500
const MODEL_PROTOCOLS: readonly DesktopModelProtocol[] = ['openai-completions', 'openai-responses']

function modelSettingsPath(): string {
  return join(app.getPath('userData'), 'primary-model.json')
}

function desktopMcpPath(): string {
  return join(app.getPath('userData'), 'mcp-servers.json')
}

function webSearchSettingsPath(): string {
  return join(app.getPath('userData'), 'web-search.json')
}

function defaultModelSettings(): DesktopModelSettings {
  return {
    configured: false,
    baseURL: 'https://api.openai.com/v1',
    model: '',
    protocol: 'openai-completions',
    apiKeyConfigured: false,
    computerUseEnabled: false,
    capabilities: { input: ['text'], verified: false },
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readStoredModelSettings(): Promise<StoredModelSettings | undefined> {
  try {
    return parseStoredModelSettings(JSON.parse(await readFile(modelSettingsPath(), 'utf8')) as unknown)
  } catch (error: unknown) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

function publicModelSettings(stored: StoredModelSettings | undefined): DesktopModelSettings {
  if (stored === undefined) return defaultModelSettings()
  return {
    configured: true,
    baseURL: stored.baseURL,
    model: stored.model,
    protocol: stored.protocol,
    apiKeyConfigured: stored.encryptedApiKey.length > 0,
    computerUseEnabled: stored.computerUseEnabled,
    capabilities: stored.capabilities,
  }
}

interface ValidatedModelUpdate {
  stored: Omit<StoredModelSettings, 'capabilities'>
  apiKey: string
}

function validateModelUpdate(value: unknown, existing: StoredModelSettings | undefined): ValidatedModelUpdate {
  if (typeof value !== 'object' || value === null) throw new Error('Model settings must be an object')
  const row = value as Partial<DesktopModelSettingsUpdate>
  const baseURL = nonEmptyString(row.baseURL, 'Base URL').trim().replace(/\/$/, '')
  const parsed = new URL(baseURL)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Base URL must use HTTP or HTTPS')
  const model = nonEmptyString(row.model, 'Model ID').trim()
  if (!MODEL_PROTOCOLS.includes(row.protocol as DesktopModelProtocol)) throw new Error('Unsupported OpenAI-compatible protocol')
  if (typeof row.computerUseEnabled !== 'boolean') throw new Error('Computer Use setting must be a boolean')
  const apiKey = typeof row.apiKey === 'string' ? row.apiKey.trim() : ''
  if (apiKey === '' && existing === undefined) throw new Error('API Key is required')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable; the API Key was not saved')
  const effectiveApiKey = apiKey === ''
    ? safeStorage.decryptString(Buffer.from(existing?.encryptedApiKey ?? '', 'base64'))
    : apiKey
  return {
    stored: {
      version: MODEL_SETTINGS_VERSION,
      baseURL,
      model,
      protocol: row.protocol as DesktopModelProtocol,
      encryptedApiKey: apiKey === '' ? existing?.encryptedApiKey ?? '' : safeStorage.encryptString(apiKey).toString('base64'),
      computerUseEnabled: row.computerUseEnabled,
    },
    apiKey: effectiveApiKey,
  }
}

async function writeStoredModelSettings(stored: StoredModelSettings): Promise<void> {
  const path = modelSettingsPath()
  const temporary = `${path}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function readStoredWebSearchSettings(): Promise<StoredWebSearchSettings | undefined> {
  try {
    return parseStoredWebSearchSettings(JSON.parse(await readFile(webSearchSettingsPath(), 'utf8')) as unknown)
  } catch (error: unknown) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

function publicWebSearchSettings(stored: StoredWebSearchSettings | undefined): DesktopWebSearchSettings {
  return { apiKeyConfigured: stored !== undefined }
}

function validateWebSearchUpdate(value: unknown, existing: StoredWebSearchSettings | undefined): StoredWebSearchSettings {
  if (typeof value !== 'object' || value === null) throw new Error('Web search settings must be an object')
  const row = value as Partial<DesktopWebSearchSettingsUpdate>
  const apiKey = typeof row.apiKey === 'string' ? row.apiKey.trim() : ''
  if (apiKey === '' && existing === undefined) throw new Error('You.com API Key is required')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable; the You.com API Key was not saved')
  return {
    version: WEB_SEARCH_SETTINGS_VERSION,
    encryptedApiKey: apiKey === '' ? existing?.encryptedApiKey ?? '' : safeStorage.encryptString(apiKey).toString('base64'),
  }
}

async function writeStoredWebSearchSettings(stored: StoredWebSearchSettings): Promise<void> {
  const path = webSearchSettingsPath()
  const temporary = `${path}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function webSearchRuntimeEnv(): Promise<Record<string, string>> {
  const stored = await readStoredWebSearchSettings()
  if (stored === undefined) return {}
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable')
  return { YDC_API_KEY: safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64')) }
}

async function modelRuntimeEnv(): Promise<Record<string, string>> {
  const scope = enterpriseRuntimeScope()
  const enterpriseEnv: Record<string, string> = scope === undefined ? {} : {
    OBIS_TENANT_ID: scope.tenantId,
    OBIS_PROJECT_ID: scope.projectId,
    OBIS_ENVIRONMENT_ID: scope.environmentId,
    OBIS_INSTALLATION_ID: scope.installationId,
  }
  const desktopModeEnv = {
    DSH_DESKTOP_CODE_WORK_ENABLED: 'true',
    DSH_DESKTOP_COMPUTER_USE_ENABLED: 'false',
    DSH_MCP_CONFIG_PATH: desktopMcpPath(),
    DSH_COMPUTER_PROVIDER: process.env.DSH_BROWSER_CDP_URL === undefined ? 'macos-accessibility' : 'browser-cdp',
    DSH_BUNDLED_SKILL_DIR: app.isPackaged ? packagedRuntimePath('app', 'skills') : resolve(REPOSITORY_ROOT, 'apps/cli/config/skills'),
    ...enterpriseEnv,
  }
  const webSearchEnv = await webSearchRuntimeEnv()
  const stored = await readStoredModelSettings()
  if (stored === undefined) return { ...desktopModeEnv, ...webSearchEnv }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable')
  return {
    ...desktopModeEnv,
    ...webSearchEnv,
    DSH_DESKTOP_MODEL_ENABLED: 'true',
    DSH_DESKTOP_MODEL_API: stored.protocol,
    DSH_DESKTOP_MODEL_BASE_URL: stored.baseURL,
    DSH_DESKTOP_MODEL_ID: stored.model,
    DSH_DESKTOP_MODEL_API_KEY: safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64')),
    DSH_DESKTOP_MODEL_INPUT: stored.capabilities.input.join(','),
    ...stored.capabilities.contextWindow === undefined ? {} : { DSH_DESKTOP_MODEL_CONTEXT_WINDOW: String(stored.capabilities.contextWindow) },
    ...stored.capabilities.maxOutputTokens === undefined ? {} : { DSH_DESKTOP_MODEL_MAX_OUTPUT_TOKENS: String(stored.capabilities.maxOutputTokens) },
    DSH_DESKTOP_COMPUTER_USE_ENABLED: String(stored.computerUseEnabled),
  }
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const entries = Object.entries(value)
  if (!entries.every(([, entry]) => typeof entry === 'string')) throw new Error(`${label} values must be strings`)
  return Object.fromEntries(entries)
}

function desktopMcpServer(value: unknown, existing: UserMcpServer | undefined): UserMcpServer {
  if (typeof value !== 'object' || value === null) throw new Error('MCP server update must be an object')
  const row = value as Partial<DesktopMcpServerUpdate>
  const serverName = nonEmptyString(row.serverName, 'MCP server name').trim()
  let secrets: Record<string, string>
  if (row.secrets !== undefined) secrets = stringRecord(row.secrets, 'MCP credentials')
  else if (row.transport === 'stdio' && existing?.transport === 'stdio') secrets = existing.env
  else if (row.transport === 'streamable-http' && existing?.transport === 'streamable-http') secrets = existing.headers
  else secrets = {}
  if (row.transport === 'stdio') {
    if (row.args !== undefined && !isStringArray(row.args)) throw new Error('MCP args must be an array of strings')
    return parseUserMcpServer({ transport: row.transport, serverName, command: nonEmptyString(row.command, 'MCP command'), args: row.args ?? [], cwd: row.cwd ?? '', env: secrets })
  }
  if (row.transport === 'streamable-http') return parseUserMcpServer({ transport: row.transport, serverName, url: nonEmptyString(row.url, 'MCP URL'), headers: secrets })
  throw new Error('Unsupported MCP transport')
}

async function desktopMcpSummaries(): Promise<DesktopMcpServerSummary[]> {
  return (await readUserMcpServers(desktopMcpPath())).map(summarizeUserMcpServer)
}

function packagedRuntimePath(...parts: string[]): string { return join(process.resourcesPath, 'runtime', ...parts) }
function desktopWorkspace(): string { return resolve(process.env.DSH_DESKTOP_WORKSPACE ?? (app.isPackaged ? app.getPath('home') : REPOSITORY_ROOT)) }
function workspacePath(value: unknown): string { if (value === undefined || value === null || value === '') return desktopWorkspace(); const raw = nonEmptyString(value, 'cwd'); if (!isAbsolute(raw)) throw new Error('cwd must be an absolute path'); return resolve(raw) }
function isBrowserPreviewable(mediaType: string): boolean { return mediaType.startsWith('text/') || mediaType.startsWith('image/') || mediaType === 'application/json' || mediaType === 'application/jsonl' || mediaType === 'application/pdf' }
function previewWebUrl(value: unknown): string { const url = new URL(nonEmptyString(value, 'url')); if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('URL must use HTTP or HTTPS'); return url.href }
type PermissionRequest = Parameters<NonNullable<AcpClientHandlers['onPermissionRequest']>>[0]
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') }
function promptParts(value: unknown): DesktopPromptPart[] { if (!Array.isArray(value) || value.length === 0) throw new Error('prompt must contain text or attachments'); return value.map((part): DesktopPromptPart => { if (typeof part !== 'object' || part === null) throw new Error('prompt contains an invalid part'); const candidate = part as Partial<DesktopPromptPart>; if (candidate.type === 'text' && typeof candidate.text === 'string') return { type: 'text', text: candidate.text }; if (candidate.type === 'attachment' && typeof candidate.attachmentId === 'string' && candidate.attachmentId !== '') return { type: 'attachment', attachmentId: candidate.attachmentId, name: typeof candidate.name === 'string' && candidate.name !== '' ? candidate.name : '附件' }; throw new Error('prompt contains an invalid part') }) }
function attachmentPaste(value: unknown): DesktopAttachmentPaste { if (typeof value !== 'object' || value === null) throw new Error('attachment paste must be an object'); const row = value as Partial<DesktopAttachmentPaste>; const selection = row.selection as DesktopAttachmentPaste['selection'] | null | undefined; if (!isStringArray(row.paths) || typeof row.imageWithoutPath !== 'boolean' || typeof selection !== 'object' || selection === null || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) || selection.start < 0 || selection.end < selection.start) throw new Error('attachment paste has invalid fields'); const paths = row.paths.map((path) => { if (!isAbsolute(path)) throw new Error('clipboard attachment paths must be absolute'); return resolve(path) }); return { paths, imageWithoutPath: row.imageWithoutPath, selection } }
async function clipboardPayload(readImage: boolean): Promise<{ paths: string[]; image?: Uint8Array }> { const items = await clipboard.read(); const values: string[] = []; let image: Uint8Array | undefined; for (const item of items) { for (const type of item.types) { const fileUrl = type === 'text/uri-list' || type.includes('public.file-url'); const png = readImage && image === undefined && type === 'image/png'; if (!fileUrl && !png) continue; const payload = await item.getType(type); if ('url' in payload) continue; if (fileUrl) values.push(await payload.text()); else image = new Uint8Array(await payload.arrayBuffer()) } } const paths: string[] = []; for (const value of values.flatMap(value => value.split(/\r?\n/))) { if (!value.startsWith('file:')) continue; try { paths.push(fileURLToPath(value)) } catch {} } return { paths, ...(image === undefined ? {} : { image }) } }
function parseRuntimeArgs(value: string | undefined): string[] { if (value === undefined || value.trim().length === 0) return []; const parsed: unknown = JSON.parse(value); if (!isStringArray(parsed)) throw new Error('DSH_DESKTOP_ACP_ARGS_JSON must be a JSON array of strings'); return parsed }

async function desktopRuntimeSpec(): Promise<AcpRuntimeSpec> {
  const env = await modelRuntimeEnv()
  const command = process.env.DSH_DESKTOP_ACP_COMMAND
  if (command !== undefined && command.trim().length > 0) return { command, args: parseRuntimeArgs(process.env.DSH_DESKTOP_ACP_ARGS_JSON), cwd: desktopWorkspace(), env }
  if (app.isPackaged) return { command: packagedRuntimePath('node', 'bin', 'node'), args: [packagedRuntimePath('app', 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js'), '--config', packagedRuntimePath('app', 'cordis.yml')], cwd: desktopWorkspace(), env }
  return { command: process.env.DSH_DESKTOP_NODE ?? process.env.npm_node_execpath ?? 'node', args: [resolve(REPOSITORY_ROOT, 'packages/examples/acp-demo/lib/bin.js'), '--config', resolve(REPOSITORY_ROOT, 'examples/acp-agent/cordis.yml')], cwd: desktopWorkspace(), env }
}

function permissionLabel(kind: PermissionRequest['options'][number]['kind']): string { switch (kind) { case 'allow_once': return 'Allow once'; case 'allow_always': return 'Allow always'; case 'reject_once': return 'Reject'; case 'reject_always': return 'Always reject'; default: return kind } }
function directoryCrumbs(path: string): DesktopDirectoryCrumb[] { const parsed = parse(path); const crumbs: DesktopDirectoryCrumb[] = []; let current = parsed.root; if (current !== '') crumbs.push({ name: parsed.root, path: parsed.root, hidden: false }); const relative = path.slice(parsed.root.length); for (const segment of relative.split(sep).filter(Boolean)) { current = current === '' ? segment : join(current, segment); crumbs.push({ name: segment, path: current, hidden: segment.startsWith('.') }) } return crumbs }
async function listDirectory(value: unknown): Promise<DesktopDirectoryListing> { const home = app.getPath('home'); const path = value === undefined || value === null || value === '' ? home : workspacePath(value); const children = await readdir(path, { withFileTypes: true }); const visible = children.filter(entry => entry.isDirectory() || entry.isFile()).sort((left, right) => { if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1; return left.name.localeCompare(right.name) }); const truncated = visible.length > DIRECTORY_LIST_LIMIT; return { path, home, crumbs: directoryCrumbs(path), entries: visible.slice(0, DIRECTORY_LIST_LIMIT).map(entry => ({ name: entry.name, path: join(path, entry.name), kind: entry.isDirectory() ? 'directory' : 'file', hidden: entry.name.startsWith('.') })), truncated } }
function childDirectory(parentValue: unknown, nameValue: unknown): string { const parent = workspacePath(parentValue), name = nonEmptyString(nameValue, 'directory name').trim(); if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('directory name must be one path segment'); return join(parent, name) }

class AcpRuntimeSupervisor {
  private connection: AcpRuntimeConnection | undefined
  private connecting: Promise<AcpRuntimeConnection> | undefined
  private window: BrowserWindow | undefined
  private readonly sessionWorkspaces = new Map<string, string>()
  attachWindow(window: BrowserWindow): void { this.window = window }
  running(): boolean { return this.connection !== undefined || this.connecting !== undefined }
  private publish(frame: DesktopRendererFrame): void { this.window?.webContents.send('dsh:frame', frame) }
  private publishStatus(status: Extract<DesktopRendererFrame, { type: 'runtime-status' }>['status'], message?: string): void { this.publish({ type: 'runtime-status', status, ...(message === undefined ? {} : { message }) }) }
  private async requestPermission(request: PermissionRequest): Promise<ReturnType<NonNullable<AcpClientHandlers['onPermissionRequest']>> extends Promise<infer R> ? R : never> { const window = this.window; if (window === undefined || request.options.length === 0) return { outcome: { outcome: 'cancelled' } }; const buttons = request.options.map(option => permissionLabel(option.kind)); const result = await dialog.showMessageBox(window, { type: 'warning', message: `Orbis AI requests permission for tool call ${request.toolCall.toolCallId}`, detail: 'Permission decides whether this action should run. Runtime sandbox policy independently constrains what it can access.', buttons, cancelId: Math.max(0, request.options.findIndex(option => option.kind.startsWith('reject_'))), noLink: true }); const option = request.options[result.response]; return option === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: option.optionId } } }
  async start(): Promise<void> {
    if (process.env.OBIS_DESKTOP_REQUIRED?.trim() === '1' && enterpriseRuntimeScope() === undefined) {
      this.publishStatus('stopped', 'Waiting for a validated enterprise runtime scope')
      throw new Error('A validated enterprise runtime scope is required before ACP Runtime can start')
    }
    if (this.connection !== undefined) return; if (this.connecting !== undefined) { await this.connecting; return } this.publishStatus('starting'); const pending = desktopRuntimeSpec().then(spec => connectAcpRuntime(spec, { onSessionUpdate: (notification) => { void assertEnterpriseSessionAccess(notification.sessionId).then(() => { this.publish({ type: 'session-update', sessionId: notification.sessionId, notification }) }).catch(() => {}) }, onPermissionRequest: request => this.requestPermission(request), onRuntimeStderr: (text) => { process.stderr.write(`[desktop-runtime] ${text}`) } })); this.connecting = pending; try { const connection = await pending; this.connection = connection; this.publishStatus('ready'); void connection.client.closed.then(() => { if (this.connection !== connection) return; this.connection = undefined; this.publishStatus('failed', 'ACP Runtime connection closed unexpectedly') }) } catch (error: unknown) { this.publishStatus('failed', error instanceof Error ? error.message : String(error)); throw error } finally { if (this.connecting === pending) this.connecting = undefined } }
  async stop(): Promise<void> { if (this.connection === undefined && this.connecting !== undefined) await this.connecting.catch(() => {}); const connection = this.connection; this.connection = undefined; this.connecting = undefined; if (connection === undefined) { this.publishStatus('stopped'); return } await connection.dispose(); this.publishStatus('stopped') }
  async restart(): Promise<void> { await this.stop(); await this.start() }
  private async runtime(): Promise<AcpRuntimeConnection> { await this.start(); if (this.connection === undefined) throw new Error('ACP Runtime is not available'); return this.connection }
  workspace(): string { return desktopWorkspace() }
  async listSessions(cwd = desktopWorkspace()): Promise<DesktopSessionSummary[]> { const runtime = await this.runtime(), result = await runtime.client.listSessions({ cwd }), rows = result.sessions.map(session => ({ sessionId: session.sessionId, cwd: session.cwd, ...(session.title === undefined || session.title === null ? {} : { title: session.title }) })); return filterEnterpriseSessions(rows) }
  async createSession(cwd = desktopWorkspace()): Promise<string> { const runtime = await this.runtime(), created = await runtime.client.newSession({ cwd, mcpServers: [] }); await claimEnterpriseSession(created.sessionId, cwd); this.sessionWorkspaces.set(created.sessionId, cwd); return created.sessionId }
  async loadSession(sessionId: string, cwd = desktopWorkspace()): Promise<void> { await assertEnterpriseSessionAccess(sessionId); const runtime = await this.runtime(); await runtime.client.loadSession({ sessionId, cwd, mcpServers: [] }); this.sessionWorkspaces.set(sessionId, cwd) }
  async prompt(sessionId: string, parts: readonly DesktopPromptPart[]): Promise<DesktopPromptResult> { await assertEnterpriseSessionAccess(sessionId); const runtime = await this.runtime(), cwd = this.sessionWorkspaces.get(sessionId) ?? desktopWorkspace(), before = await desktopContent().snapshot(cwd), prompt: ContentBlock[] = [], attachmentIds: string[] = []; for (const part of parts) { if (part.type === 'text') { if (part.text !== '') prompt.push({ type: 'text', text: part.text }); continue } prompt.push(...await desktopContent().promptBlocks(sessionId, [part.attachmentId])); attachmentIds.push(part.attachmentId) } const result = await runtime.client.prompt({ sessionId, prompt }); desktopContent().consumeAttachments(sessionId, [...new Set(attachmentIds)]); return { stopReason: result.stopReason, artifacts: await desktopContent().captureArtifacts(sessionId, cwd, before) } }
  cancel(sessionId: string): void { void assertEnterpriseSessionAccess(sessionId).then(() => this.runtime()).then(runtime => runtime.client.cancel({ sessionId })).catch((error: unknown) => { this.publishStatus('failed', error instanceof Error ? error.message : String(error)) }) }
  async closeSession(sessionId: string): Promise<void> { await assertEnterpriseSessionAccess(sessionId); const runtime = await this.runtime(); await runtime.client.closeSession({ sessionId }) }
}

const supervisor = new AcpRuntimeSupervisor()
let contentStore: DesktopContentStore | undefined
function desktopContent(): DesktopContentStore { contentStore ??= new DesktopContentStore(join(app.getPath('home'), '.dsh', 'skills'), () => app.isPackaged ? packagedRuntimePath('app', 'skills') : resolve(REPOSITORY_ROOT, 'apps/cli/config/skills')); return contentStore }
function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean { return event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true }
function nonEmptyString(value: unknown, label: string): string { if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`); return value }

function installIpc(): void {
  ipcMain.handle('dsh:workspace', (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return supervisor.workspace() })
  ipcMain.handle('dsh:session-list', async (event, rawCwd: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return supervisor.listSessions(workspacePath(rawCwd)) })
  ipcMain.handle('dsh:session-create', async (event, rawCwd: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return supervisor.createSession(workspacePath(rawCwd)) })
  ipcMain.handle('dsh:session-load', async (event, rawSessionId: unknown, rawCwd: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); await supervisor.loadSession(nonEmptyString(rawSessionId, 'sessionId'), workspacePath(rawCwd)) })
  ipcMain.handle('dsh:session-prompt', async (event, rawSessionId: unknown, rawPrompt: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return supervisor.prompt(nonEmptyString(rawSessionId, 'sessionId'), promptParts(rawPrompt)) })
  ipcMain.on('dsh:session-cancel', (event, value: unknown) => { if (trustedSender(event) && typeof value === 'string' && value.length > 0) supervisor.cancel(value) })
  ipcMain.handle('dsh:session-close', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); await supervisor.closeSession(nonEmptyString(value, 'sessionId')) })
  ipcMain.handle('dsh:directory-pick', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const window = BrowserWindow.fromWebContents(event.sender), options: Electron.OpenDialogOptions = { defaultPath: desktopWorkspace(), properties: ['openDirectory', 'createDirectory'] }; const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options); return result.canceled ? null : result.filePaths[0] ?? null })
  ipcMain.handle('dsh:directory-list', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return listDirectory(value) })
  ipcMain.handle('dsh:directory-create', async (event, rawParent: unknown, rawName: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const path = childDirectory(rawParent, rawName); await mkdir(path); return path })
  ipcMain.handle('dsh:path-open', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const path = workspacePath(value), error = await shell.openPath(path); if (error !== '') throw new Error(error) })
  ipcMain.handle('dsh:preview-prepare', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const path = workspacePath(value), info = await stat(path); if (info.isDirectory()) return { kind: 'directory' as const, path }; if (!info.isFile()) throw new Error('Preview target must be a file or directory'); const mediaType = desktopMediaType(path); return { kind: 'file' as const, path, url: pathToFileURL(path).href, title: basename(path), mediaType, previewable: isBrowserPreviewable(mediaType) } })
  ipcMain.handle('dsh:url-open-external', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); await shell.openExternal(previewWebUrl(value)) })
  ipcMain.handle('dsh:skill-list', async (event, rawCwd: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return desktopContent().listSkills(workspacePath(rawCwd)) })
  ipcMain.handle('dsh:skill-import', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const window = BrowserWindow.fromWebContents(event.sender), options: Electron.OpenDialogOptions = { title: '导入 Skill', message: '选择包含 SKILL.md 的文件夹，或直接选择 SKILL.md', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Skill', extensions: ['md'] }] }; const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options), path = result.filePaths[0]; return result.canceled || path === undefined ? null : desktopContent().importSkill(path) })
  ipcMain.handle('dsh:skill-remove', async (event, rawName: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); await desktopContent().removeSkill(nonEmptyString(rawName, 'Skill name')) })
  ipcMain.handle('dsh:attachment-pick', async (event, rawSessionId: unknown, rawCwd: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const sessionId=nonEmptyString(rawSessionId,'sessionId');await assertEnterpriseSessionAccess(sessionId);const window = BrowserWindow.fromWebContents(event.sender), options: Electron.OpenDialogOptions = { title: '添加图片或文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '支持的图片与普通文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'markdown', 'html', 'json', 'jsonl', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsv', 'tsx', 'css', 'py', 'go', 'rs', 'java', 'swift', 'c', 'cpp', 'sh', 'sql', 'toml'] }] }; const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options); if (result.canceled) return []; return desktopContent().stageAttachments(sessionId, workspacePath(rawCwd), result.filePaths) })
  ipcMain.handle('dsh:attachment-paste', async (event, rawSessionId: unknown, rawCwd: unknown, rawPaste: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const sessionId = nonEmptyString(rawSessionId, 'sessionId'); await assertEnterpriseSessionAccess(sessionId); const cwd = workspacePath(rawCwd), paste = attachmentPaste(rawPaste), payload = await clipboardPayload(paste.imageWithoutPath), paths = [...new Set([...paste.paths, ...payload.paths])], added = await desktopContent().referenceAttachments(sessionId, cwd, paths); if (payload.image !== undefined) added.push(await desktopContent().stageClipboardImage(sessionId, cwd, payload.image)); return added })
  ipcMain.handle('dsh:attachment-reference', async (event, rawSessionId: unknown, rawCwd: unknown, rawPaths: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); if (!isStringArray(rawPaths) || rawPaths.length === 0) throw new Error('attachment paths must be a non-empty string array'); const sessionId=nonEmptyString(rawSessionId,'sessionId');await assertEnterpriseSessionAccess(sessionId);const paths = rawPaths.map((path) => { if (!isAbsolute(path)) throw new Error('attachment paths must be absolute'); return resolve(path) }); return desktopContent().referenceAttachments(sessionId, workspacePath(rawCwd), paths) })
  ipcMain.handle('dsh:attachment-remove', async (event, rawSessionId: unknown, rawId: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const sessionId=nonEmptyString(rawSessionId,'sessionId');await assertEnterpriseSessionAccess(sessionId);await desktopContent().removeAttachment(sessionId, nonEmptyString(rawId, 'attachmentId')) })
  ipcMain.handle('dsh:artifact-save', async (event, rawSessionId: unknown, rawPath: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const sessionId = nonEmptyString(rawSessionId, 'sessionId'); await assertEnterpriseSessionAccess(sessionId); const path = workspacePath(rawPath), window = BrowserWindow.fromWebContents(event.sender), options: Electron.SaveDialogOptions = { title: '另存产物', defaultPath: basename(path) }, result = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options); if (result.canceled) return null; await desktopContent().copyArtifact(sessionId, path, result.filePath); return result.filePath })
  ipcMain.handle('dsh:artifact-export', async (event, rawSessionId: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const sessionId = nonEmptyString(rawSessionId, 'sessionId'); await assertEnterpriseSessionAccess(sessionId); const window = BrowserWindow.fromWebContents(event.sender), options: Electron.SaveDialogOptions = { title: '导出全部产物', defaultPath: `dsh-artifacts-${sessionId.slice(0, 8)}.zip` }, result = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options); if (result.canceled) return null; await desktopContent().exportZip(sessionId, result.filePath); return result.filePath })
  ipcMain.handle('dsh:model-settings', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return publicModelSettings(await readStoredModelSettings()) })
  ipcMain.handle('dsh:model-settings-save', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const existing = await readStoredModelSettings(), update = validateModelUpdate(value, existing), sameEndpoint = existing !== undefined && update.stored.baseURL === existing.baseURL && update.stored.model === existing.model && update.stored.protocol === existing.protocol && update.stored.encryptedApiKey === existing.encryptedApiKey && existing.capabilities.verified, capabilities = sameEndpoint ? existing.capabilities : await probeDesktopModel({ baseURL: update.stored.baseURL, model: update.stored.model, protocol: update.stored.protocol, apiKey: update.apiKey }), stored: StoredModelSettings = { ...update.stored, capabilities }; await writeStoredModelSettings(stored); await supervisor.restart(); return publicModelSettings(stored) })
  ipcMain.handle('dsh:web-search-settings', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return publicWebSearchSettings(await readStoredWebSearchSettings()) })
  ipcMain.handle('dsh:web-search-settings-save', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const stored = validateWebSearchUpdate(value, await readStoredWebSearchSettings()); await writeStoredWebSearchSettings(stored); await supervisor.restart(); return publicWebSearchSettings(stored) })
  ipcMain.handle('dsh:mcp-list', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return desktopMcpSummaries() })
  ipcMain.handle('dsh:mcp-save', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const current = await readUserMcpServers(desktopMcpPath()), rawName = typeof value === 'object' && value !== null ? (value as { serverName?: unknown }).serverName : undefined, existing = typeof rawName === 'string' ? current.find(server => server.serverName === rawName) : undefined, servers = await upsertUserMcpServer(desktopMcpPath(), desktopMcpServer(value, existing)); await supervisor.restart(); return servers.map(summarizeUserMcpServer) })
  ipcMain.handle('dsh:mcp-remove', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const servers = await removeUserMcpServer(desktopMcpPath(), nonEmptyString(value, 'MCP server name')); await supervisor.restart(); return servers.map(summarizeUserMcpServer) })
  ipcMain.handle('dsh:runtime-restart', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); await supervisor.restart() })
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
function installResourceProtocol(): void { protocol.handle('dsh-app', async (request) => { const url = new URL(request.url); if (url.host !== 'app' || request.method !== 'GET') return new Response('not found', { status: 404 }); const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html', path = resolve(RENDERER_ROOT, relative); if (path !== RENDERER_ROOT && !path.startsWith(RENDERER_ROOT + sep)) return new Response('forbidden', { status: 403 }); try { const body = await readFile(path); return new Response(body, { headers: { 'content-type': MIME[extname(path)] ?? 'application/octet-stream', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; frame-src http: https: file: about:; connect-src 'none'; base-uri 'none'; form-action 'none'" } }) } catch { return new Response('not found', { status: 404 }) } }) }

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 860, minHeight: 560, title: 'Orbis AI', titleBarStyle: 'hidden', trafficLightPosition: { x: 18, y: 18 }, backgroundColor: '#ffffff', webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: true } })
  const routePreviewUrl = (url: string): void => { try { window.webContents.send('dsh:preview-request', previewWebUrl(url)) } catch {} }
  window.webContents.setWindowOpenHandler(({ url }) => { routePreviewUrl(url); return { action: 'deny' } })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => { let allowed = false; try { const source = params.src ?? '', protocol = new URL(source).protocol; allowed = protocol === 'http:' || protocol === 'https:' || protocol === 'file:' || params.src === 'about:blank' } catch { allowed = false } if (!allowed) { event.preventDefault(); return } delete webPreferences.preload; webPreferences.nodeIntegration = false; webPreferences.contextIsolation = true; webPreferences.sandbox = true; webPreferences.webSecurity = true; webPreferences.allowRunningInsecureContent = false })
  if (!app.isPackaged) window.webContents.on('console-message', (_event, _level, message) => { process.stderr.write(`[desktop-renderer] ${message}\n`) })
  window.webContents.on('will-navigate', (event, url) => { if (url.startsWith(`${APP_ORIGIN}/`)) return; event.preventDefault(); routePreviewUrl(url) })
  supervisor.attachWindow(window)
  await window.loadURL(`${APP_ORIGIN}/index.html`)
  return window
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  await app.whenReady()
  app.on('web-contents-created', (_event, contents) => { if (contents.getType() !== 'webview') return; contents.setWindowOpenHandler(({ url }) => { try { const parsed = new URL(url); if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:') void contents.loadURL(parsed.href) } catch {} return { action: 'deny' } }); contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) }) })
  installResourceProtocol()
  installIpc()
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
  const window = await createWindow()
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus() })
  const runtimeStart = supervisor.start()
  if (process.env.DSH_DESKTOP_DIST_SMOKE === '1') void runtimeStart.then(() => supervisor.listSessions()).then(() => { process.stderr.write('desktop-dist-smoke: ready\n'); app.quit() }).catch((error: unknown) => { process.stderr.write(`desktop-dist-smoke: ${error instanceof Error ? error.message : String(error)}\n`); app.exit(1) }); else void runtimeStart.catch(() => {})
}

app.on('before-quit', (event) => { if (!supervisor.running()) return; event.preventDefault(); void supervisor.stop().finally(() => { app.quit() }) })
app.on('window-all-closed', () => { app.quit() })
void main()
