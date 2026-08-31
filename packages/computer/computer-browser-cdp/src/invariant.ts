/** Invariant entrypoint for @deepseek-ai/dsh-computer-browser-cdp. @module @deepseek-ai/dsh-computer-browser-cdp/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'computer-browser-cdp-invariant'
export const inject = ['invariants']
// No runtime invariant: the provider exposes no authoritative connection snapshot outside dsh-computer.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-computer-browser-cdp', install))
