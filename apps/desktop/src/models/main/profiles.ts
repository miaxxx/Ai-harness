/** Encrypted model profiles and endpoint verification owned by Electron Main. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { effectiveModelCapabilities, parseModelOverrides } from '../../desktop-model-policy.ts'
import { probeDesktopModel } from '../../desktop-model-capabilities.ts'
import { MODEL_SETTINGS_VERSION, parseStoredModelSettings, type StoredModelSettings, type StoredSubagentModelSettings } from '../../desktop-model-storage.ts'
import type { DesktopModelSettings, DesktopModelSettingsUpdate, DesktopModelProtocol, DesktopSubagentModelSettingsUpdate, DesktopModelDiscoveryInput } from '../../shared.ts'
import { discoverDesktopModels } from './catalog.ts'
const MODEL_PROTOCOLS: readonly DesktopModelProtocol[] = ['openai-completions', 'openai-responses']
function modelSettingsPath(): string { return join(app.getPath('userData'), 'primary-model.json') }
function nonEmptyString(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value.trim() }
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

async function readLegacyModelSettings(): Promise<StoredModelSettings | undefined> {
  try {
    return parseStoredModelSettings(JSON.parse(await readFile(modelSettingsPath(), 'utf8')) as unknown)
  } catch (error: unknown) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

interface ModelProfiles {
  version: 1
  defaultId?: string | undefined
  profiles: StoredModelSettings[]
}

async function readModelProfiles(): Promise<ModelProfiles> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(app.getPath('userData'), 'model-profiles.json'), 'utf8'))
    if (typeof raw !== 'object' || raw === null) throw new Error('模型列表格式无效')
    const row = raw as { version?: unknown; profiles?: unknown; defaultId?: unknown }
    if (row.version !== 1 || !Array.isArray(row.profiles)) throw new Error('模型列表格式无效')
    const profiles = row.profiles.map(parseStoredModelSettings)
    const ids = profiles.map(profile => profile.id)
    if (ids.some(id => id === undefined) || new Set(ids).size !== ids.length
      || (row.defaultId !== undefined && !ids.includes(row.defaultId as string))
      || (profiles.length > 0 && row.defaultId === undefined)) throw new Error('模型列表引用无效')
    return { version: 1, profiles, ...(row.defaultId === undefined ? {} : { defaultId: row.defaultId as string }) }
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error
    const legacy = await readLegacyModelSettings()
    if (legacy === undefined) return { version: 1, profiles: [] }
    // Old records did not distinguish detected capacities from explicit edits.
    const { contextWindow: _legacyContext, maxOutputTokens: _legacyOutput, ...detected } = legacy.capabilities
    const imported = { ...legacy, capabilities: detected, id: 'primary', overrides: legacy.overrides ?? {
      contextWindow: legacy.capabilities.contextWindow ?? 32768,
      maxOutputTokens: Math.min(legacy.capabilities.maxOutputTokens ?? 8192, legacy.capabilities.contextWindow ?? 32768),
    } }
    if (imported.subagent !== undefined && imported.subagent.overrides === undefined) {
      const { contextWindow, maxOutputTokens, ...capabilities } = imported.subagent.capabilities
      imported.subagent = { ...imported.subagent, capabilities, overrides: {
        ...(contextWindow === undefined ? {} : { contextWindow }), ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      } }
    }
    return { version: 1, defaultId: 'primary', profiles: [imported] }
  }
}

async function writeModelProfiles(profiles: ModelProfiles): Promise<void> {
  const path = join(app.getPath('userData'), 'model-profiles.json')
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(profiles, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

let modelMutation: Promise<unknown> = Promise.resolve()
function mutateModels<T>(operation: () => Promise<T>): Promise<T> {
  const pending = modelMutation.then(operation)
  modelMutation = pending.catch(() => {
    // A failed settings mutation must not prevent later user corrections.
  })
  return pending
}

async function readStoredModelSettings(): Promise<StoredModelSettings | undefined> {
  const catalog = await readModelProfiles()
  return catalog.profiles.find(profile => profile.id === catalog.defaultId)
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
    id: stored.id,
    name: stored.name,
    overrides: stored.overrides,
    detectedCapabilities: stored.capabilities,
    capabilities: effectiveModelCapabilities(stored.capabilities, stored.overrides),
    ...stored.subagent === undefined
      ? {}
      : {
        subagent: {
          baseURL: stored.subagent.baseURL,
          model: stored.subagent.model,
          protocol: stored.subagent.protocol,
          apiKeyConfigured: stored.subagent.encryptedApiKey.length > 0,
          capabilities: effectiveModelCapabilities(stored.subagent.capabilities, stored.subagent.overrides),
          overrides: stored.subagent.overrides,
        },
      },
  }
}

interface ValidatedEndpointUpdate {
  stored: Omit<StoredSubagentModelSettings, 'capabilities'>
  apiKey: string
}

interface ValidatedModelUpdate {
  stored: Omit<StoredModelSettings, 'capabilities' | 'subagent'> & {
    subagent?: Omit<StoredSubagentModelSettings, 'capabilities'>
  }
  primaryApiKey: string
  subagentApiKey?: string
}

function validateModelEndpoint(
  value: unknown,
  existing: Pick<StoredSubagentModelSettings, 'encryptedApiKey' | 'baseURL' | 'protocol'> | undefined,
  label: string,
): ValidatedEndpointUpdate {
  if (typeof value !== 'object' || value === null) throw new Error(`${label} settings must be an object`)
  const row = value as Partial<DesktopModelSettingsUpdate>
  const baseURL = nonEmptyString(row.baseURL, `${label} Base URL`).trim().replace(/\/$/, '')
  const parsed = new URL(baseURL)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} Base URL must use HTTP or HTTPS`)
  }
  const model = nonEmptyString(row.model, `${label} Model ID`).trim()
  if (!MODEL_PROTOCOLS.includes(row.protocol as DesktopModelProtocol)) {
    throw new Error(`Unsupported ${label} OpenAI-compatible protocol`)
  }
  const apiKey = typeof row.apiKey === 'string' ? row.apiKey.trim() : ''
  if (apiKey === '' && existing === undefined) throw new Error('API Key is required')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('macOS secure storage is unavailable; the API Key was not saved')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${label} Base URL must not contain credentials, query or fragment`)
  if (apiKey === '' && existing !== undefined && (existing.baseURL.replace(/\/+$/, '') !== baseURL.replace(/\/+$/, '') || existing.protocol !== row.protocol)) throw new Error('不同接口或协议必须填写对应 API Key')
  const effectiveApiKey = apiKey === ''
    ? safeStorage.decryptString(Buffer.from(existing?.encryptedApiKey ?? '', 'base64'))
    : apiKey
  return {
    stored: {
      baseURL,
      model,
      protocol: row.protocol as DesktopModelProtocol,
      overrides: parseModelOverrides(row.overrides),
      encryptedApiKey: apiKey === ''
        ? existing?.encryptedApiKey ?? ''
        : safeStorage.encryptString(apiKey).toString('base64'),
    },
    apiKey: effectiveApiKey,
  }
}

function validateModelUpdate(value: unknown, existing: StoredModelSettings | undefined): ValidatedModelUpdate {
  if (typeof value !== 'object' || value === null) throw new Error('Model settings must be an object')
  const row = value as Partial<DesktopModelSettingsUpdate>
  if (typeof row.computerUseEnabled !== 'boolean') throw new Error('Computer Use setting must be a boolean')
  const primary = validateModelEndpoint(row, existing, 'Primary model')
  const subagent = row.subagent === undefined
    ? undefined
    : validateModelEndpoint(row.subagent, existing?.subagent, 'Subagent model')
  return {
    stored: {
      version: MODEL_SETTINGS_VERSION,
      id: typeof row.id === 'string' ? nonEmptyString(row.id, 'model id') : randomUUID(),
      name: typeof row.name === 'string' ? row.name.trim() : primary.stored.model,
      ...primary.stored,
      computerUseEnabled: row.computerUseEnabled,
      ...subagent === undefined ? {} : { subagent: subagent.stored },
    },
    primaryApiKey: primary.apiKey,
    ...subagent === undefined ? {} : { subagentApiKey: subagent.apiKey },
  }
}

function sameModelEndpoint(
  next: Omit<StoredSubagentModelSettings, 'capabilities'>,
  current: StoredSubagentModelSettings | StoredModelSettings | undefined,
): current is StoredSubagentModelSettings | StoredModelSettings {
  return current !== undefined
    && next.baseURL === current.baseURL
    && next.model === current.model
    && next.protocol === current.protocol
    && next.encryptedApiKey === current.encryptedApiKey
    && current.capabilities.verified
}


/** Serialized profile mutations; credentials never cross the native IPC bridge. */
export class DesktopModelProfiles {
  /** Read the selected immutable configuration for a new Runtime. */
  read = readStoredModelSettings
  /** Project the selected configuration without encrypted credentials. */
  async settings() { return publicModelSettings(await readStoredModelSettings()) }
  /** List redacted profiles and their selected id. */
  async list() {
    const catalog = await readModelProfiles()
    return {
      profiles: catalog.profiles.map(publicModelSettings),
      ...(catalog.defaultId === undefined ? {} : { defaultId: catalog.defaultId }),
    }
  }
  /** Verify and atomically save a main endpoint and optional dedicated subagent. */
  save(value: unknown) { return mutateModels(async () => {
    const catalog = await readModelProfiles()
    if (typeof value !== 'object' || value === null) throw new Error('Model settings must be an object')
    const row = value as DesktopModelSettingsUpdate
    const existing = catalog.profiles.find(profile => profile.id === row.id)
    const reuse = row.reuseKeyFrom === undefined ? undefined : catalog.profiles.find(profile => profile.id === row.reuseKeyFrom)
    if (row.reuseKeyFrom !== undefined && reuse === undefined) throw new Error('要复用的密钥配置不存在')
    if (reuse !== undefined && (reuse.baseURL !== row.baseURL.replace(/\/$/, '') || reuse.protocol !== row.protocol)) throw new Error('密钥仅能复用到同一接口与协议')
    if (row.id !== undefined && existing === undefined) throw new Error('要编辑的模型不存在')
    const update = validateModelUpdate(value, existing ?? reuse)
    const { subagent: pendingSubagent, ...primaryStored } = update.stored
    const existingSubagent = existing?.subagent
    const primaryUnchanged = !row.recheck && sameModelEndpoint(update.stored, existing)
    const unchangedSubagent = !row.recheck && pendingSubagent !== undefined
      && sameModelEndpoint(pendingSubagent, existingSubagent)
      ? existingSubagent
      : undefined
    const [capabilities, subagentCapabilities] = await Promise.all([
      primaryUnchanged
        ? Promise.resolve(existing.capabilities)
        : probeDesktopModel({
          baseURL: update.stored.baseURL,
          model: update.stored.model,
          protocol: update.stored.protocol,
          apiKey: update.primaryApiKey,
        }),
      pendingSubagent === undefined
        ? Promise.resolve(undefined)
        : unchangedSubagent !== undefined
          ? Promise.resolve(unchangedSubagent.capabilities)
          : probeDesktopModel({
            baseURL: pendingSubagent.baseURL,
            model: pendingSubagent.model,
            protocol: pendingSubagent.protocol,
            apiKey: update.subagentApiKey as string,
          }),
    ])
    const stored: StoredModelSettings = {
      ...primaryStored,
      capabilities,
      ...pendingSubagent === undefined || subagentCapabilities === undefined
        ? {}
        : { subagent: { ...pendingSubagent, capabilities: subagentCapabilities } },
    }
    effectiveModelCapabilities(stored.capabilities, stored.overrides)
    if (stored.subagent !== undefined && effectiveModelCapabilities(stored.subagent.capabilities, stored.subagent.overrides).contextWindow === undefined) throw new Error('请填写子 Agent 整个上下文窗口')
    if (effectiveModelCapabilities(stored.capabilities, stored.overrides).contextWindow === undefined) throw new Error('接口未返回上下文窗口，请填写整个上下文窗口后保存')
    catalog.profiles = [...catalog.profiles.filter(profile => profile.id !== stored.id), stored]
    catalog.defaultId ??= stored.id
    await writeModelProfiles(catalog)
    return publicModelSettings(stored)
  }) }
  /** Verify an explicit draft; stored credentials require the same endpoint and protocol. */
  async inspect(value: unknown, target: 'primary' | 'subagent' = 'primary', profileId?: string) {
    if (typeof value !== 'object' || value === null) throw new Error('Model settings must be an object')
    const row = value as DesktopModelSettingsUpdate | DesktopSubagentModelSettingsUpdate
    const id = profileId ?? ('id' in row ? row.id ?? row.reuseKeyFrom : undefined)
    const profile = (await readModelProfiles()).profiles.find(item => item.id === id)
    const existing = target === 'subagent' ? profile?.subagent : profile
    const endpoint = validateModelEndpoint(value, existing, 'Model')
    return probeDesktopModel({ ...endpoint.stored, apiKey: endpoint.apiKey })
  }
  /** Select an already verified profile without changing an active request. */
  select(id: string) { return mutateModels(async () => {
    const catalog = await readModelProfiles()
    if (!catalog.profiles.some(profile => profile.id === id)) throw new Error('所选模型不存在')
    catalog.defaultId = id
    await writeModelProfiles(catalog)
  }) }
  /** Remove a profile and choose the first remaining one when the default is removed. */
  remove(id: string) { return mutateModels(async () => {
    const catalog = await readModelProfiles()
    if (!catalog.profiles.some(profile => profile.id === id)) throw new Error('所选模型不存在')
    catalog.profiles = catalog.profiles.filter(profile => profile.id !== id)
    if (catalog.defaultId === id) catalog.defaultId = catalog.profiles[0]?.id
    await writeModelProfiles(catalog)
  }) }
  /** Discover a saved or draft endpoint without reusing credentials across endpoints. */
  async discover(value?: unknown) {
    let input: DesktopModelDiscoveryInput | undefined
    if (value !== undefined) {
      if (typeof value !== 'object' || value === null) throw new Error('模型检测参数必须是对象')
      const row = value as Partial<DesktopModelDiscoveryInput>
      if (typeof row.baseURL !== 'string' || typeof row.apiKey !== 'string' || typeof row.model !== 'string' || (row.id !== undefined && typeof row.id !== 'string') || (row.protocol !== undefined && !MODEL_PROTOCOLS.includes(row.protocol))) throw new Error('模型检测参数无效')
      input = row as DesktopModelDiscoveryInput
    }
    const existing = input?.id === undefined
      ? await readStoredModelSettings()
      : (await readModelProfiles()).profiles.find(profile => profile.id === input.id)
    const endpoint = input ?? existing
    if (endpoint === undefined) return { models: [], source: 'configured' as const, warning: '请先配置模型接口' }
    const baseURL = endpoint.baseURL
    const url = new URL(baseURL)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 无效')
    let apiKey = input?.apiKey.trim() ?? ''
    if (!apiKey) {
      if (existing === undefined || (existing.baseURL.replace(/\/+$/, '') !== baseURL.replace(/\/+$/, '') || (input?.protocol !== undefined && input.protocol !== existing.protocol))) throw new Error('检测不同接口时请填写对应 API Key')
      apiKey = safeStorage.decryptString(Buffer.from(existing.encryptedApiKey, 'base64'))
    }
    return discoverDesktopModels({ baseURL, apiKey, configuredModel: endpoint.model })
  }
  /** Verify and select a model advertised by the selected profile endpoint. */
  async selectModel(model: string) {
    const existing = await readStoredModelSettings()
    if (!existing) throw new Error('请先配置模型接口')
    if (!(await this.discover()).models.some(item => item.id === model)) throw new Error('该模型不在当前接口目录中')
    return this.save({ ...publicModelSettings(existing), model, apiKey: '', ...(existing.subagent === undefined ? {} : { subagent: { ...existing.subagent, apiKey: '' } }) })
  }
}
