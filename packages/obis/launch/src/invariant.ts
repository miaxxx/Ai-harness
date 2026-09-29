/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-obis-launch`.
 * @module @deepseek-ai/dsh-obis-launch/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-obis-launch'

/** Cordis companion plugin name. */
export const name = 'obis-launch-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Workspace launch exchange stores the delegated token in
 * credentials and overlays Kernel pages; enterprise entitlement and page
 * authority remain Kernel-owned HTTP facts, not a Harness event relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
