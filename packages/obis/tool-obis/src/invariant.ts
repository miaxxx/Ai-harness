/** Package-owned invariant companion for the OBIS native tool adapter. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-obis'

export const name = 'tool-obis-invariant'
export const inject = ['invariants']

// Enterprise authorization and mutation invariants live in OBIS. This adapter
// intentionally owns no duplicate policy state inside Harness.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
