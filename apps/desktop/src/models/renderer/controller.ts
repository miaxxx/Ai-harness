/** Plugin-owned model state shared by Settings and the composer without exposing credentials. */
import type { DesktopBridge, DesktopModelCatalog, DesktopModelSettings, DesktopModelSettingsUpdate } from '../../shared.ts'

/** Immutable presentation state for both Desktop model controls. */
export interface DesktopModelState {
  settings: DesktopModelSettings | null
  catalog: DesktopModelCatalog | null
  busy: boolean
  error: string | null
}

/** Renderer controller whose mutations resolve after the Main-owned Runtime transition. */
export class DesktopModelController {
  private state: DesktopModelState = { settings: null, catalog: null, busy: false, error: null }
  private readonly listeners = new Set<() => void>()
  private loading: Promise<void> | undefined
  constructor(private readonly bridge: Pick<DesktopBridge, 'modelSettings' | 'discoverModels' | 'saveModelSettings' | 'selectModel'>) {}

  /** Return the stable immutable snapshot consumed by React. */
  getSnapshot = (): DesktopModelState => this.state
  /** Register a presentation listener and return its cleanup. */
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<DesktopModelState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Load saved configuration and discover its model directory once per plugin instance. */
  load(): Promise<void> {
    this.loading ??= this.perform(async () => {
      const settings = await this.bridge.modelSettings()
      this.update({ settings })
      if (settings.configured) this.update({ catalog: await this.bridge.discoverModels() })
    })
    return this.loading
  }

  private async perform(operation: () => Promise<void>): Promise<void> {
    if (this.state.busy) throw new Error('模型操作正在进行，请稍后重试')
    this.update({ busy: true, error: null })
    try { await operation() }
    catch (error: unknown) { this.update({ error: error instanceof Error ? error.message : String(error) }); throw error }
    finally { this.update({ busy: false }) }
  }

  /** Detect the saved endpoint or explicit unsaved endpoint fields. */
  async detect(input?: Parameters<DesktopBridge['discoverModels']>[0]): Promise<DesktopModelCatalog> {
    let result!: DesktopModelCatalog
    await this.perform(async () => {
      result = await this.bridge.discoverModels(input)
      if (input === undefined) this.update({ catalog: result })
    })
    return result
  }

  /** Verify, save and apply a model configuration, then refresh its directory. */
  async save(input: DesktopModelSettingsUpdate): Promise<DesktopModelSettings> {
    let result!: DesktopModelSettings
    await this.perform(async () => {
      result = await this.bridge.saveModelSettings(input)
      this.update({ settings: result, catalog: null })
      this.update({ catalog: await this.bridge.discoverModels() })
    })
    return result
  }

  /** Apply one advertised or explicitly configured model to subsequent and restored sessions. */
  async select(model: string): Promise<void> {
    if (model === this.state.settings?.model) return
    await this.perform(async () => {
      const settings = await this.bridge.selectModel(model)
      this.update({ settings })
    })
  }
}
