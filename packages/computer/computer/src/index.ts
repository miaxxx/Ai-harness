/** Replaceable target-aware computer-control service (`ctx.computer`). @module @deepseek-ai/dsh-computer */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { computerError } from './types.ts'
import type { ComputerAction, ComputerObservation, ComputerObservationMode, ComputerProvider, ComputerTarget, ComputerTargetKind } from './types.ts'

export type {
  ComputerAccessibilityObservation, ComputerAction, ComputerBounds, ComputerElement, ComputerErrorCode,
  ComputerObservation, ComputerObservationMode, ComputerPoint, ComputerProvider, ComputerTarget, ComputerTargetKind,
  ComputerVisualObservation,
} from './types.ts'
export { ComputerError, computerError } from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { computer: ComputerRuntime } }

/** Optional runtime routing preferences for Computer providers. */
export interface ComputerRuntimeConfig {
  /** Provider id used only to break ties when multiple available Providers support the same target kind. */
  readonly provider?: string
}

/** Registry and deterministic target-aware router. Providers remain stateless across calls. */
export class ComputerRuntime extends Service {
  static Config: z<ComputerRuntimeConfig> = z.object({ provider: z.string() })
  private readonly providers = new Map<string, ComputerProvider>()
  private readonly preferredProvider: string | undefined

  constructor(ctx: Context, config: ComputerRuntimeConfig = {}) {
    super(ctx, 'computer')
    this.preferredProvider = config.provider ?? process.env.DSH_COMPUTER_PROVIDER
  }

  /**
   * Register one target-aware Provider for the lifetime of the returned disposer.
   * @param provider - Provider whose id must be unique in this runtime.
   * @returns a disposer that removes exactly this Provider registration.
   */
  register(provider: ComputerProvider): () => void {
    if (this.providers.has(provider.id)) throw new Error(`computer provider "${provider.id}" is already registered`)
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'computer.registerProvider()')
    return () => void dispose()
  }

  private usable(kind?: ComputerTargetKind): ComputerProvider[] {
    return [...this.providers.values()].filter(provider =>
      provider.available() && (kind === undefined || provider.targetKinds.includes(kind)))
  }

  private providerFor(target: ComputerTarget): ComputerProvider {
    const candidates = this.usable(target.kind)
    const first = candidates[0]
    if (first === undefined) throw computerError('ACTION_UNSUPPORTED', `No available provider supports ${target.kind} targets.`)
    if (candidates.length === 1) return first
    const preferred = this.preferredProvider === undefined ? undefined : candidates.find(provider => provider.id === this.preferredProvider)
    if (preferred !== undefined) return preferred
    throw computerError('ACTION_UNSUPPORTED', `More than one provider supports ${target.kind}; configure a provider tie-breaker.`)
  }

  /**
   * List currently visible targets from every usable Provider.
   * @param kind - Optional target category filter applied to Providers and results.
   * @param signal - Optional cancellation signal forwarded to every selected Provider.
   * @returns the combined current target list.
   */
  async listTargets(kind?: ComputerTargetKind, signal?: AbortSignal): Promise<readonly ComputerTarget[]> {
    signal?.throwIfAborted()
    const providers = this.usable(kind)
    const groups = await Promise.all(providers.map(provider => provider.listTargets(signal)))
    return groups.flat().filter(target => kind === undefined || target.kind === kind)
  }

  /**
   * Observe a named target directly; discovery is not a prerequisite.
   * @param target - Exact target to route by category.
   * @param mode - Requested semantic, visual, or combined state.
   * @param signal - Optional cancellation signal forwarded to the selected Provider.
   * @returns fresh bounded state for the target.
   */
  observe(target: ComputerTarget, mode: ComputerObservationMode = 'accessibility', signal?: AbortSignal): Promise<ComputerObservation> {
    signal?.throwIfAborted()
    return this.providerFor(target).observe(target, mode, signal)
  }

  /**
   * Perform one bounded action through the target's Provider.
   * @param target - Exact target to route by category.
   * @param action - Input operation to perform.
   * @param signal - Optional cancellation signal forwarded to the selected Provider.
   * @returns fresh Provider-produced state after the action settles.
   */
  perform(target: ComputerTarget, action: ComputerAction, signal?: AbortSignal): Promise<ComputerObservation> {
    signal?.throwIfAborted()
    return this.providerFor(target).perform(target, action, signal)
  }
}
export default ComputerRuntime
