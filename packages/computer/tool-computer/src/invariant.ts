/** Invariant companion for `@deepseek-ai/dsh-tool-computer`. @module @deepseek-ai/dsh-tool-computer/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'tool-computer-invariant'
export const inject = ['invariants']
// No runtime invariant: tool registration is already owned and checked by the Tools service.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-tool-computer', install))
