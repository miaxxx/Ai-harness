/** Replaceable local computer-control service (`ctx.computer`). @module @deepseek-ai/dsh-computer */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ComputerAction, ComputerApp, ComputerProvider, ComputerSnapshot } from './types.ts'

export type { ComputerAction, ComputerApp, ComputerElement, ComputerProvider, ComputerSnapshot } from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { computer: ComputerRuntime } }

/** Provider-selection settings for local computer control. */
export interface ComputerRuntimeConfig {
  /** Provider id selected for this composition. Omit only when one usable provider is mounted. */
  readonly provider?: string
}

/** Registry and execution owner for exactly one configured local computer Provider. */
export class ComputerRuntime extends Service {
  static Config: z<ComputerRuntimeConfig> = z.object({ provider: z.string() })
  private readonly providers = new Map<string, ComputerProvider>()
  private readonly providerId: string | undefined
  constructor(ctx: Context, config: ComputerRuntimeConfig = {}) {
    super(ctx, 'computer')
    this.providerId = config.provider ?? process.env.DSH_COMPUTER_PROVIDER
  }
  /**
   * Register one local computer Provider.
   * @param provider - provider implementation identified by its stable id.
   * @returns disposer that removes the provider.
   */
  register(provider: ComputerProvider): () => void {
    if (this.providers.has(provider.id)) throw new Error(`computer provider "${provider.id}" is already registered`)
    const providers = this.providers
    const dispose = this.ctx.effect(function* () { providers.set(provider.id, provider); yield () => providers.delete(provider.id) }, 'computer.registerProvider()')
    return () => void dispose()
  }
  private provider(): ComputerProvider {
    const usable = [...this.providers.values()].filter(provider => provider.available())
    const provider = this.providerId === undefined ? (usable.length === 1 ? usable[0] : undefined) : this.providers.get(this.providerId)
    if (provider === undefined || !provider.available()) throw new Error('No usable local computer provider is configured.')
    return provider
  }
  /**
   * List apps exposed by the selected Provider.
   * @param signal - cancellation signal for provider work.
   * @returns visible app identifiers and labels.
   */
  listApps(signal?: AbortSignal): Promise<readonly ComputerApp[]> { return this.provider().listApps(signal) }
  /**
   * Inspect one selected app.
   * @param app - Provider app id returned by {@link listApps}.
   * @param includeScreenshot - whether the snapshot includes pixels.
   * @param signal - cancellation signal for provider work.
   * @returns a bounded current app snapshot.
   */
  inspect(app: string, includeScreenshot: boolean, signal?: AbortSignal): Promise<ComputerSnapshot> {
    return this.provider().inspect(app, includeScreenshot, signal)
  }
  /**
   * Perform one bounded app action through the selected Provider.
   * @param app - Provider app id returned by {@link listApps}.
   * @param action - fixed input operation to perform.
   * @param signal - cancellation signal for provider work.
   * @returns the app snapshot after the action.
   */
  act(app: string, action: ComputerAction, signal?: AbortSignal): Promise<ComputerSnapshot> {
    return this.provider().act(app, action, signal)
  }
}
export default ComputerRuntime
