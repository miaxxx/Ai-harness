/**
 * Electron main process: secure window/resource ownership, typed Renderer IPC,
 * and lifecycle supervision for leased standalone ACP Runtime revisions.
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, safeStorage, shell,
} from 'electron'
import {
  type AcpRuntimeSpec,
} from '@deepseek-ai/dsh-acp-client'
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
  DesktopWebSearchSettings,
  DesktopWebSearchSettingsUpdate,
} from './shared.ts'
import { attachBusinessHost, openBusinessWindow } from './desktop-business-window.ts'
import { desktopMediaType, DesktopContentStore } from './desktop-content.ts'
import { desktopObisRuntimeEnvironment } from './desktop-obis-identity-main.ts'
import type { DesktopPromptPart } from './desktop-prompt.ts'
import { DesktopRuntimeCredentialLifetime } from './desktop-runtime-credential.ts'
import { DesktopModelProfiles } from './models/main/profiles.ts'
import { DesktopRuntimePool } from './runtime/main/pool.ts'
import { AcpRuntimeSupervisor } from './runtime/main/supervisor.ts'
import { DesktopDiagnostics } from './diagnostics/main/diagnostics.ts'
import { verifyDesktopTheme } from './platform/main/theme-smoke.ts'
import { resolveDesktopToolPath } from './platform/main/tool-path.ts'
import { effectiveModelCapabilities } from './desktop-model-policy.ts'
import {
  type StoredModelSettings,
} from './desktop-model-storage.ts'
import {
  WEB_SEARCH_SETTINGS_VERSION,
  parseStoredWebSearchSettings,
  type StoredWebSearchSettings,
} from './desktop-web-search-storage.ts'
import {
  assertEnterpriseSessionAccess,
  enterpriseRuntimeScope,
  onEnterpriseRuntimeScopeChange,
} from './desktop-enterprise-scope-main.ts'

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}])

const APP_ORIGIN = 'dsh-app://app'
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const RENDERER_ROOT = resolve(fileURLToPath(new URL('./renderer/', import.meta.url)))
const DIRECTORY_LIST_LIMIT = 500
function desktopMcpPath(): string {
  return join(app.getPath('userData'), 'mcp-servers.json')
}

function webSearchSettingsPath(): string {
  return join(app.getPath('userData'), 'web-search.json')
}

function isMissingFile(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }
const modelManager = new DesktopModelProfiles()
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

async function modelRuntimeEnv(snapshot: StoredModelSettings | undefined): Promise<Record<string, string>> {
  const scope = enterpriseRuntimeScope()
  const enterpriseEnv: Record<string, string> = scope === undefined ? {} : {
    ...await desktopObisRuntimeEnvironment(scope), OBIS_TENANT_ID: scope.tenantId,
    OBIS_PROJECT_ID: scope.projectId, OBIS_ENVIRONMENT_ID: scope.environmentId,
    OBIS_INSTALLATION_ID: scope.installationId,
  }
  const desktopModeEnv = {
    ...enterpriseEnv,
    DSH_DESKTOP_MODEL_ENABLED: 'false',
    DSH_DESKTOP_SUBAGENT_MODEL_ENABLED: 'false',
    DSH_DESKTOP_MODEL_REASONING: '',
    DSH_DESKTOP_SUBAGENT_MODEL_REASONING: '',
    DSH_DESKTOP_NPM_CACHE: (process.platform === 'win32' ? join(desktopWorkspace(), '.dsh', 'cache', 'npm') : join(app.getPath('userData'), 'cache', 'npm')),
    npm_config_cache: (process.platform === 'win32' ? join(desktopWorkspace(), '.dsh', 'cache', 'npm') : join(app.getPath('userData'), 'cache', 'npm')),
    NPM_CONFIG_CACHE: (process.platform === 'win32' ? join(desktopWorkspace(), '.dsh', 'cache', 'npm') : join(app.getPath('userData'), 'cache', 'npm')),
    DSH_DESKTOP_CODE_WORK_ENABLED: 'true',
    DSH_DESKTOP_DIAGNOSTICS_ENABLED: 'true',
    // Mutating actions remain one-shot approval-gated in the ACP Runtime.
    DSH_DESKTOP_COMPUTER_USE_ENABLED: 'false',
    DSH_MCP_CONFIG_PATH: desktopMcpPath(),
    // A local Chromium DevTools endpoint takes precedence over visual macOS control.
    DSH_COMPUTER_PROVIDER: process.env.DSH_BROWSER_CDP_URL === undefined ? 'macos-accessibility' : 'browser-cdp',
    DSH_BUNDLED_SKILL_DIR: app.isPackaged
      ? packagedRuntimePath('app', 'skills')
      : resolve(REPOSITORY_ROOT, 'apps/cli/config/skills'),
  }
  const webSearchEnv = await webSearchRuntimeEnv()
  if (snapshot === undefined) return { ...desktopModeEnv, ...webSearchEnv }
  const stored = { ...snapshot, capabilities: effectiveModelCapabilities(snapshot.capabilities, snapshot.overrides),
    ...(snapshot.subagent === undefined ? {} : { subagent: {
      ...snapshot.subagent, capabilities: effectiveModelCapabilities(snapshot.subagent.capabilities, snapshot.subagent.overrides),
    } }),
  }
  // Unknown legacy profiles can open Settings and session history, but cannot admit a model request.
  if (stored.capabilities.contextWindow === undefined
    || (stored.subagent !== undefined && stored.subagent.capabilities.contextWindow === undefined)) {
    throw new Error('请先在模型设置中填写整个上下文窗口')
  }
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
    ...snapshot.overrides?.reasoning === undefined ? {} : { DSH_DESKTOP_MODEL_REASONING: snapshot.overrides.reasoning },
    DSH_DESKTOP_MODEL_REASONING_EFFORTS: JSON.stringify(Object.keys(snapshot.capabilities.reasoningEfforts ?? {}).some(level => level !== 'off') ? snapshot.capabilities.reasoningEfforts : false),
    DSH_DESKTOP_MODEL_CONTEXT_WINDOW: String(stored.capabilities.contextWindow),
    ...stored.capabilities.maxOutputTokens === undefined
      ? {}
      : { DSH_DESKTOP_MODEL_MAX_OUTPUT_TOKENS: String(stored.capabilities.maxOutputTokens) },
    DSH_DESKTOP_COMPUTER_USE_ENABLED: String(stored.computerUseEnabled),
    ...stored.subagent === undefined
      ? {}
      : {
        DSH_DESKTOP_SUBAGENT_MODEL_ENABLED: 'true',
        DSH_DESKTOP_SUBAGENT_MODEL_API: stored.subagent.protocol,
        DSH_DESKTOP_SUBAGENT_MODEL_BASE_URL: stored.subagent.baseURL,
        DSH_DESKTOP_SUBAGENT_MODEL_ID: stored.subagent.model,
        DSH_DESKTOP_SUBAGENT_MODEL_API_KEY: safeStorage.decryptString(
          Buffer.from(stored.subagent.encryptedApiKey, 'base64'),
        ),
        DSH_DESKTOP_SUBAGENT_MODEL_INPUT: stored.subagent.capabilities.input.join(','),
        DSH_DESKTOP_SUBAGENT_MODEL_REASONING_EFFORTS: JSON.stringify(Object.keys(stored.subagent.capabilities.reasoningEfforts ?? {}).some(level => level !== 'off') ? stored.subagent.capabilities.reasoningEfforts : false),
        ...(stored.subagent.overrides?.reasoning === undefined
          ? {} : { DSH_DESKTOP_SUBAGENT_MODEL_REASONING: stored.subagent.overrides.reasoning }),
        ...stored.subagent.capabilities.contextWindow === undefined
          ? {}
          : { DSH_DESKTOP_SUBAGENT_MODEL_CONTEXT_WINDOW: String(stored.subagent.capabilities.contextWindow) },
        ...stored.subagent.capabilities.maxOutputTokens === undefined
          ? {}
          : { DSH_DESKTOP_SUBAGENT_MODEL_MAX_OUTPUT_TOKENS: String(stored.subagent.capabilities.maxOutputTokens) },
      },
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
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') }
function promptParts(value: unknown): DesktopPromptPart[] { if (!Array.isArray(value) || value.length === 0) throw new Error('prompt must contain text or attachments'); return value.map((part): DesktopPromptPart => { if (typeof part !== 'object' || part === null) throw new Error('prompt contains an invalid part'); const candidate = part as Partial<DesktopPromptPart>; if (candidate.type === 'text' && typeof candidate.text === 'string') return { type: 'text', text: candidate.text }; if (candidate.type === 'attachment' && typeof candidate.attachmentId === 'string' && candidate.attachmentId !== '') return { type: 'attachment', attachmentId: candidate.attachmentId, name: typeof candidate.name === 'string' && candidate.name !== '' ? candidate.name : '附件' }; throw new Error('prompt contains an invalid part') }) }
function attachmentPaste(value: unknown): DesktopAttachmentPaste { if (typeof value !== 'object' || value === null) throw new Error('attachment paste must be an object'); const row = value as Partial<DesktopAttachmentPaste>; const selection = row.selection as DesktopAttachmentPaste['selection'] | null | undefined; if (!isStringArray(row.paths) || typeof row.imageWithoutPath !== 'boolean' || typeof selection !== 'object' || selection === null || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) || selection.start < 0 || selection.end < selection.start) throw new Error('attachment paste has invalid fields'); const paths = row.paths.map((path) => { if (!isAbsolute(path)) throw new Error('clipboard attachment paths must be absolute'); return resolve(path) }); return { paths, imageWithoutPath: row.imageWithoutPath, selection } }
async function clipboardPayload(readImage: boolean): Promise<{ paths: string[]; image?: Uint8Array }> { const items = await clipboard.read(); const values: string[] = []; let image: Uint8Array | undefined; for (const item of items) { for (const type of item.types) { const fileUrl = type === 'text/uri-list' || type.includes('public.file-url'); const png = readImage && image === undefined && type === 'image/png'; if (!fileUrl && !png) continue; const payload = await item.getType(type); if ('url' in payload) continue; if (fileUrl) values.push(await payload.text()); else image = new Uint8Array(await payload.arrayBuffer()) } } const paths: string[] = []; for (const value of values.flatMap(value => value.split(/\r?\n/))) { if (!value.startsWith('file:')) continue; try { paths.push(fileURLToPath(value)) } catch {} } return { paths, ...(image === undefined ? {} : { image }) } }
function parseRuntimeArgs(value: string | undefined): string[] { if (value === undefined || value.trim().length === 0) return []; const parsed: unknown = JSON.parse(value); if (!isStringArray(parsed)) throw new Error('DSH_DESKTOP_ACP_ARGS_JSON must be a JSON array of strings'); return parsed }

async function desktopRuntimeSpec(
  lifetime: DesktopRuntimeCredentialLifetime, snapshot: StoredModelSettings | undefined,
): Promise<AcpRuntimeSpec> {
  const env = await modelRuntimeEnv(snapshot)
  env.PATH = await resolveDesktopToolPath(
    app.isPackaged ? packagedRuntimePath('node', 'bin') : undefined,
  )
  lifetime.setExpiry(env.OBIS_DELEGATED_EXPIRES_AT)
  delete env.OBIS_DELEGATED_EXPIRES_AT
  const command = process.env.DSH_DESKTOP_ACP_COMMAND
  if (command !== undefined && command.trim().length > 0) {
    return {
      command,
      args: parseRuntimeArgs(process.env.DSH_DESKTOP_ACP_ARGS_JSON),
      cwd: desktopWorkspace(),
      env,
    }
  }
  if (app.isPackaged) return { command: packagedRuntimePath('node', 'bin', 'node'), args: [packagedRuntimePath('app', 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js'), '--config', packagedRuntimePath('app', 'cordis.yml')], cwd: desktopWorkspace(), env }
  return { command: process.env.DSH_DESKTOP_NODE ?? process.env.npm_node_execpath ?? 'node', args: [resolve(REPOSITORY_ROOT, 'packages/examples/acp-demo/lib/bin.js'), '--config', resolve(REPOSITORY_ROOT, 'examples/acp-agent/cordis.yml')], cwd: desktopWorkspace(), env }
}

function directoryCrumbs(path: string): DesktopDirectoryCrumb[] { const parsed = parse(path); const crumbs: DesktopDirectoryCrumb[] = []; let current = parsed.root; if (current !== '') crumbs.push({ name: parsed.root, path: parsed.root, hidden: false }); const relative = path.slice(parsed.root.length); for (const segment of relative.split(sep).filter(Boolean)) { current = current === '' ? segment : join(current, segment); crumbs.push({ name: segment, path: current, hidden: segment.startsWith('.') }) } return crumbs }
async function listDirectory(value: unknown): Promise<DesktopDirectoryListing> { const home = app.getPath('home'); const path = value === undefined || value === null || value === '' ? home : workspacePath(value); const children = await readdir(path, { withFileTypes: true }); const visible = children.filter(entry => entry.isDirectory() || entry.isFile()).sort((left, right) => { if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1; return left.name.localeCompare(right.name) }); const truncated = visible.length > DIRECTORY_LIST_LIMIT; return { path, home, crumbs: directoryCrumbs(path), entries: visible.slice(0, DIRECTORY_LIST_LIMIT).map(entry => ({ name: entry.name, path: join(path, entry.name), kind: entry.isDirectory() ? 'directory' : 'file', hidden: entry.name.startsWith('.') })), truncated } }
function childDirectory(parentValue: unknown, nameValue: unknown): string { const parent = workspacePath(parentValue), name = nonEmptyString(nameValue, 'directory name').trim(); if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('directory name must be one path segment'); return join(parent, name) }

const supervisor = new DesktopRuntimePool(
  () => modelManager.read(),
  snapshot => new AcpRuntimeSupervisor(desktopRuntimeSpec, snapshot, desktopContent, desktopDiagnostics, desktopWorkspace),
  desktopWorkspace,
  (previous, next) => { desktopContent().transferDraftAttachments(previous, next) },
)
onEnterpriseRuntimeScopeChange((_previous, next) => {
  const draining = diagnosticsStore?.shutdown()
  void supervisor.invalidate(true).then(async () => {
    await draining
    if (next !== undefined) await supervisor.start()
  }).catch((error: unknown) => { console.error('[enterprise-scope] failed to rotate ACP Runtime:', error) })
})
let diagnosticsStore: DesktopDiagnostics | undefined
function desktopDiagnostics(): DesktopDiagnostics {
  diagnosticsStore ??= new DesktopDiagnostics(join(app.getPath('userData'), 'logs', 'turns'), (error) => { console.error('[desktop-diagnostics]', error) })
  return diagnosticsStore
}
let contentStore: DesktopContentStore | undefined
function desktopContent(): DesktopContentStore { contentStore ??= new DesktopContentStore(join(app.getPath('home'), '.dsh', 'skills'), () => app.isPackaged ? packagedRuntimePath('app', 'skills') : resolve(REPOSITORY_ROOT, 'apps/cli/config/skills'), enterpriseRuntimeScope); return contentStore }
function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean { const raw = event.senderFrame?.url; if (raw === undefined) return false; try { const url = new URL(raw); return url.protocol === 'dsh-app:' && url.host === 'app' } catch { return false } }
function nonEmptyString(value: unknown, label: string): string { if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`); return value }

function installIpc(): void {
  ipcMain.handle('dsh:workspace', (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return supervisor.workspace() })
  ipcMain.handle('dsh:session-list', async (event, rawCwd: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return supervisor.listSessions(workspacePath(rawCwd)) })
  ipcMain.handle('dsh:session-create', async (event, rawCwd: unknown, replaceEmptySessionId?: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const previous = replaceEmptySessionId === undefined ? undefined : nonEmptyString(replaceEmptySessionId, 'replaceEmptySessionId'); if (previous !== undefined) await assertEnterpriseSessionAccess(previous); return supervisor.createSession(workspacePath(rawCwd), previous) })
  ipcMain.handle('dsh:session-prepare', async (event, rawSessionId: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const id = nonEmptyString(rawSessionId, 'sessionId'); await assertEnterpriseSessionAccess(id); return supervisor.prepareSession(id) })
  ipcMain.handle('dsh:session-load', async (event, rawSessionId: unknown, rawCwd: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); await supervisor.loadSession(nonEmptyString(rawSessionId, 'sessionId'), workspacePath(rawCwd)) })
  ipcMain.handle('dsh:session-prompt', async (event, rawSessionId: unknown, rawPrompt: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    const sessionId = nonEmptyString(rawSessionId, 'sessionId')
    await assertEnterpriseSessionAccess(sessionId)
    if (supervisor.busy(sessionId)) throw new Error('同一会话已有任务正在运行')
    const parts = promptParts(rawPrompt)
    const log = desktopDiagnostics().begin(sessionId, { sessionId, parts })
    try {
      const result = await supervisor.prompt(sessionId, parts)
      await desktopDiagnostics().finish(sessionId, log, 'completed', result)
      return result
    } catch (error: unknown) {
      await desktopDiagnostics().finish(sessionId, log, 'failed', { error })
      throw error
    }
  })
  ipcMain.on('dsh:session-cancel', (event, value: unknown) => { if (trustedSender(event) && typeof value === 'string' && value.length > 0) void assertEnterpriseSessionAccess(value).then(() => { supervisor.cancel(value) }).catch(console.error) })
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
  ipcMain.handle('dsh:model-settings', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return modelManager.settings() })
  ipcMain.handle('dsh:model-profiles', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return modelManager.list() })
  ipcMain.handle('dsh:model-inspect', async (event, value: unknown, target: unknown, profileId: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    if (target !== undefined && target !== 'primary' && target !== 'subagent') throw new Error('模型检测目标无效')
    return modelManager.inspect(value, target, profileId === undefined ? undefined : nonEmptyString(profileId, 'profileId'))
  })
  ipcMain.handle('dsh:model-settings-save', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return modelManager.save(value) })
  ipcMain.handle('dsh:model-discover', async (event, value) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return modelManager.discover(value) })
  ipcMain.handle('dsh:model-select', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return modelManager.selectModel(nonEmptyString(value, 'model')) })
  ipcMain.handle('dsh:model-profile-select', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return modelManager.select(nonEmptyString(value, 'profileId')) })
  ipcMain.handle('dsh:model-remove', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return modelManager.remove(nonEmptyString(value, 'profileId')) })
  ipcMain.handle('dsh:turn-log-open', async (event, rawSessionId: unknown, rawMessageId: unknown) => {
    if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender')
    const sessionId = nonEmptyString(rawSessionId, 'sessionId')
    const messageId = nonEmptyString(rawMessageId, 'messageId')
    await assertEnterpriseSessionAccess(sessionId)
    const path = await desktopDiagnostics().find(sessionId, messageId)
    await assertEnterpriseSessionAccess(sessionId)
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.handle('dsh:web-search-settings', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return publicWebSearchSettings(await readStoredWebSearchSettings()) })
  ipcMain.handle('dsh:web-search-settings-save', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const stored = validateWebSearchUpdate(value, await readStoredWebSearchSettings()); await writeStoredWebSearchSettings(stored); await supervisor.restart(); return publicWebSearchSettings(stored) })
  ipcMain.handle('dsh:mcp-list', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); return desktopMcpSummaries() })
  ipcMain.handle('dsh:mcp-save', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const current = await readUserMcpServers(desktopMcpPath()), rawName = typeof value === 'object' && value !== null ? (value as { serverName?: unknown }).serverName : undefined, existing = typeof rawName === 'string' ? current.find(server => server.serverName === rawName) : undefined, servers = await upsertUserMcpServer(desktopMcpPath(), desktopMcpServer(value, existing)); await supervisor.restart(); return servers.map(summarizeUserMcpServer) })
  ipcMain.handle('dsh:mcp-remove', async (event, value: unknown) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); const servers = await removeUserMcpServer(desktopMcpPath(), nonEmptyString(value, 'MCP server name')); await supervisor.restart(); return servers.map(summarizeUserMcpServer) })
  ipcMain.handle('dsh:runtime-restart', async (event) => { if (!trustedSender(event)) throw new Error('desktop IPC rejected an untrusted sender'); await supervisor.restart() })
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
function installResourceProtocol(): void { protocol.handle('dsh-app', async (request) => { const url = new URL(request.url); if (url.host !== 'app' || request.method !== 'GET') return new Response('not found', { status: 404 }); const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html', path = resolve(RENDERER_ROOT, relative); if (path !== RENDERER_ROOT && !path.startsWith(RENDERER_ROOT + sep)) return new Response('forbidden', { status: 403 }); try { const body = await readFile(path); return new Response(body, { headers: { 'content-type': MIME[extname(path)] ?? 'application/octet-stream', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; frame-src http: https: file: about:; connect-src 'none'; base-uri 'none'; form-action 'none'" } }) } catch { return new Response('not found', { status: 404 }) } }) }

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 860, minHeight: 560, title: 'Orbis AI', titleBarStyle: 'hidden', trafficLightPosition: { x: 18, y: 18 }, backgroundColor: '#ffffff', webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: true } })
  const routePreviewUrl = (url: string): void => { try { window.webContents.send('dsh:preview-request', previewWebUrl(url)) } catch {} }
  window.webContents.setWindowOpenHandler(({ url }) => { routePreviewUrl(url); return { action: 'deny' } })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => { let allowed = false; try { const source = params.src ?? '', protocol = new URL(source).protocol; allowed = protocol === 'http:' || protocol === 'https:' || protocol === 'file:' || params.src === 'about:blank' } catch { allowed = false } if (!allowed) { event.preventDefault(); return } delete webPreferences.preload; webPreferences.nodeIntegration = false; webPreferences.contextIsolation = true; webPreferences.sandbox = true; webPreferences.webSecurity = true; webPreferences.allowRunningInsecureContent = false })
  if (!app.isPackaged) window.webContents.on('console-message', (_event, _level, message) => { process.stderr.write(`[desktop-renderer] ${message}\n`) })
  window.webContents.on('will-navigate', (event, url) => { if (url.startsWith(`${APP_ORIGIN}/`)) return; event.preventDefault(); routePreviewUrl(url) })
  attachBusinessHost(window)
  supervisor.attachWindow(window)
  await window.loadURL(`${APP_ORIGIN}/index.html`)
  return window
}

async function main(): Promise<void> {
  const isolatedData = process.env.DSH_DESKTOP_USER_DATA?.trim()
    || (app.commandLine.hasSwitch('user-data-dir') ? undefined : join(app.getPath('appData'), 'Orbis AI'))
  if (isolatedData) {
    if (!isAbsolute(isolatedData)) throw new Error('DSH_DESKTOP_USER_DATA must be an absolute directory.')
    await mkdir(isolatedData, { recursive: true, mode: 0o700 })
    app.setPath('userData', isolatedData)
  }
  await mkdir((process.platform === 'win32' ? join(desktopWorkspace(), '.dsh', 'cache', 'npm') : join(app.getPath('userData'), 'cache', 'npm')), { recursive: true, mode: 0o700 })
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  await app.whenReady()
  app.on('web-contents-created', (_event, contents) => { if (contents.getType() !== 'webview') return; contents.setWindowOpenHandler(({ url }) => { try { const parsed = new URL(url); if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:') void contents.loadURL(parsed.href) } catch {} return { action: 'deny' } }); contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) }) })
  installResourceProtocol()
  installIpc()
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { label: '业务工作台', submenu: [
    { label: '业务应用', click: () => { void openBusinessWindow('applications').catch((error: unknown) => { void dialog.showMessageBox({ message: String(error), type: 'error' }) }) } },
    { label: '公共空间', click: () => { void openBusinessWindow('spaces').catch((error: unknown) => { void dialog.showMessageBox({ message: String(error), type: 'error' }) }) } },
    { label: '资料库', click: () => { void openBusinessWindow('knowledge').catch((error: unknown) => { void dialog.showMessageBox({ message: String(error), type: 'error' }) }) } },
    { label: '业务构建器', click: () => { void openBusinessWindow('builder').catch((error: unknown) => { void dialog.showMessageBox({ message: String(error), type: 'error' }) }) } },
  ] }, { role: 'editMenu', label: '编辑' }, { role: 'windowMenu', label: '窗口' }]))
  const window = await createWindow()
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus() })
  window.on('unresponsive', () => { desktopDiagnostics().broadcast('renderer-unresponsive', {}) })
  window.on('responsive', () => { desktopDiagnostics().broadcast('renderer-responsive', {}) })
  window.webContents.on('render-process-gone', (_event, details) => { desktopDiagnostics().broadcast('renderer-crash', details) })
  const runtimeStart = supervisor.start()
  if (process.env.DSH_DESKTOP_DIST_SMOKE === '1') void runtimeStart.then(() => supervisor.listSessions()).then(async () => { await verifyDesktopTheme(window); process.stderr.write('desktop-dist-smoke: ready\n'); app.quit() }).catch((error: unknown) => { process.stderr.write(`desktop-dist-smoke: ${error instanceof Error ? error.message : String(error)}\n`); app.exit(1) }); else void runtimeStart.catch(() => {})
}

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || (!supervisor.running() && diagnosticsStore === undefined)) return
  event.preventDefault()
  quitting = true
  void (async () => {
    try { await supervisor.stop() } finally { await diagnosticsStore?.shutdown() }
  })()
    .catch((error: unknown) => { console.error('[desktop-shutdown]', error) })
    .finally(() => { app.quit() })
})
app.on('window-all-closed', () => { app.quit() })
void main()
