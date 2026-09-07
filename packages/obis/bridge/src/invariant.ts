/** Package-owned invariant companion for the OHP bridge. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-obis-bridge'

export const name = 'obis-bridge-invariant'
export const inject = ['invariants']

// OHP is a transport boundary. Enterprise authority remains server-side in
// OBIS, so the bridge intentionally owns no duplicate Policy/Approval state.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
