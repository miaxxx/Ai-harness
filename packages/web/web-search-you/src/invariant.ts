/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-web-search-you`.
 * @module @deepseek-ai/dsh-web-search-you/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-search-you'
/** Cordis companion plugin name. */
export const name = 'web-search-you-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: search results have no independent event sequence or retained mutable state. */
const install: InvariantInstaller = () => {}

/**
 * Register package ownership with the shared invariant service.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
