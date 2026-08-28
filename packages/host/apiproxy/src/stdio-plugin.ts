/**
 * Cordis adapter that exposes the composed ApiProxy through the versioned
 * stdio Fetch carrier. stdout is reserved exclusively for protocol frames.
 * @module @deepseek-ai/dsh-host-apiproxy/stdio-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { toFetchHandler } from './fetch/handler.ts'
import { serveStdioFetch } from './fetch/stdio.ts'

/** Stable Cordis plugin name. */
export const name = 'host-apiproxy-stdio'

/** Gateway required before the carrier starts reading stdin. */
export const inject = ['apiProxy']

/**
 * Bind the host gateway to process stdin/stdout for this plugin fiber's
 * lifetime. Disposing the fiber aborts every active request and awaits it.
 * @param ctx - plugin context carrying the composed API gateway.
 */
export function apply(ctx: Context): void {
  const server = serveStdioFetch({
    handler: toFetchHandler(ctx.apiProxy),
    input: process.stdin,
    output: process.stdout,
  })
  ctx.effect(() => async () => { await server.close() }, 'host-apiproxy-stdio: process streams')
}
