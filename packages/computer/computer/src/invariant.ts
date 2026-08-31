/** Invariant companion for `@deepseek-ai/dsh-computer`. @module @deepseek-ai/dsh-computer/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'computer-invariant'
export const inject = ['invariants']
// No runtime invariant: provider registration is already owned and checked by the Computer service.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-computer', install))
