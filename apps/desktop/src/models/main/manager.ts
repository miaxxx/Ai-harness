/** Main-owned model discovery and serialized configuration transitions. */
import { discoverDesktopModels } from './catalog.ts'
import { probeDesktopModel } from '../../desktop-model-capabilities.ts'
import type { StoredModelSettings } from '../../desktop-model-storage.ts'
import type { DesktopModelCatalog, DesktopModelDiscoveryInput, DesktopModelSettingsUpdate } from '../../shared.ts'

/** Main-process persistence, credential and Runtime operations; never exposed to the Renderer. */
export interface DesktopModelManagerHost {
  read(this: void): Promise<StoredModelSettings | undefined>
  write(this: void, settings: StoredModelSettings): Promise<void>
  validate(this: void, value: unknown, existing: StoredModelSettings | undefined): { stored: Omit<StoredModelSettings, 'capabilities'>; apiKey: string }
  decrypt(this: void, settings: StoredModelSettings): string
  restart(this: void): Promise<void>
  active(this: void): boolean
}

function normalizedURL(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写 Base URL')
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 必须是无内嵌凭据的 HTTP(S) 地址')
  return value.trim().replace(/\/+$/, '')
}

/** Coordinates discovery and model changes while keeping active prompts on their current model. */
export class DesktopModelManager {
  changing = false
  constructor(private readonly host: DesktopModelManagerHost) {}

  /**
   * Discover a saved endpoint or validate a draft endpoint before credential reuse.
   * @param value - Optional untrusted IPC draft fields.
   * @returns Advertised models or an explicit configured-model fallback.
   */
  async discover(value?: unknown): Promise<DesktopModelCatalog> {
    const existing = await this.host.read()
    if (value === undefined) {
      if (!existing) return { models: [], source: 'configured', warning: '请先配置模型接口' }
      return discoverDesktopModels({ baseURL: existing.baseURL, apiKey: this.host.decrypt(existing), configuredModel: existing.model })
    }
    if (typeof value !== 'object' || value === null) throw new Error('模型检测参数必须是对象')
    const input = value as Partial<DesktopModelDiscoveryInput>
    const baseURL = normalizedURL(input.baseURL)
    if (typeof input.apiKey !== 'string' || typeof input.model !== 'string') throw new Error('模型检测参数无效')
    let apiKey = input.apiKey.trim()
    if (!apiKey) {
      if (!existing || normalizedURL(existing.baseURL) !== baseURL) throw new Error('检测不同接口时请填写对应 API Key')
      apiKey = this.host.decrypt(existing)
    }
    return discoverDesktopModels({ baseURL, apiKey, configuredModel: input.model })
  }

  private async transition(operation: () => Promise<StoredModelSettings>): Promise<StoredModelSettings> {
    if (this.changing) throw new Error('模型配置正在切换，请稍后重试')
    if (this.host.active()) throw new Error('请等待所有回复完成后再切换模型')
    this.changing = true
    try { return await operation() }
    finally { this.changing = false }
  }

  /** Verify the endpoint before saving; restore the previous model if Runtime reconnection fails. */
  private async apply(value: unknown, existing: StoredModelSettings | undefined): Promise<StoredModelSettings> {
    const update = this.host.validate(value, existing)
    const sameEndpoint = existing && existing.capabilities.verified
      && update.stored.baseURL === existing.baseURL && update.stored.model === existing.model
      && update.stored.protocol === existing.protocol && update.stored.encryptedApiKey === existing.encryptedApiKey
    const capabilities = sameEndpoint ? existing.capabilities : await probeDesktopModel({
      baseURL: update.stored.baseURL, model: update.stored.model, protocol: update.stored.protocol, apiKey: update.apiKey,
    })
    const stored = { ...update.stored, capabilities }
    await this.host.write(stored)
    try { await this.host.restart() }
    catch (error: unknown) {
      if (existing) { await this.host.write(existing); await this.host.restart() }
      throw error
    }
    return stored
  }

  /**
   * Validate and apply an IPC settings update without overlapping another transition.
   * @param value - Untrusted settings submitted by the native settings editor.
   * @returns The verified stored configuration.
   */
  save(value: unknown): Promise<StoredModelSettings> {
    return this.transition(async () => this.apply(value, await this.host.read()))
  }

  /**
   * Select an advertised model and verify inference before changing the active configuration.
   * @param value - Untrusted model ID submitted by the composer.
   * @returns The verified configuration after Runtime reconnection.
   */
  select(value: unknown): Promise<StoredModelSettings> {
    return this.transition(async () => {
      if (typeof value !== 'string' || !value.trim()) throw new Error('请选择模型')
      const existing = await this.host.read()
      if (!existing) throw new Error('请先配置模型接口')
      if (value === existing.model) return existing
      const catalog = await this.discover()
      if (!catalog.models.some(model => model.id === value)) throw new Error('该模型不在当前接口目录中，请重新检测')
      const update: DesktopModelSettingsUpdate = { baseURL: existing.baseURL, model: value, protocol: existing.protocol, apiKey: '', computerUseEnabled: existing.computerUseEnabled }
      return this.apply(update, existing)
    })
  }
}
