/** Invariant companion for `@deepseek-ai/dsh-mcp-user-config`. @module @deepseek-ai/dsh-mcp-user-config/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'mcp-user-config-invariant'
export const inject = ['invariants']
// No runtime invariant: the plugin exposes no authoritative server snapshot outside the MCP client.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@deepseek-ai/dsh-mcp-user-config', install),
)
