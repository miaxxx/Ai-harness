/** User-owned MCP server document, runtime mounting, and model-facing management. @module @deepseek-ai/dsh-mcp-user-config */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'mcp-user-config'
/** Services required by the bridge. */
export const inject = ['tools']

const DOCUMENT_VERSION = 1
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** One persisted child-process MCP server. */
export interface UserStdioMcpServer {
  transport: 'stdio'
  serverName: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

/** One persisted Streamable HTTP MCP server. */
export interface UserHttpMcpServer {
  transport: 'streamable-http'
  serverName: string
  url: string
  headers: Record<string, string>
}

/** One user-configured MCP server. */
export type UserMcpServer = UserStdioMcpServer | UserHttpMcpServer

/** Redacted MCP server information safe for a settings Renderer. */
export interface UserMcpServerSummary {
  serverName: string
  transport: UserMcpServer['transport']
  target: string
  secretNames: string[]
  command?: string
  args?: string[]
  cwd?: string
  url?: string
}

/** Plugin configuration for the user MCP document. */
export interface Config {
  /** JSON document path; defaults to `$DSH_MCP_CONFIG_PATH` or `~/.dsh/mcp-servers.json`. */
  path?: string
}

/** Schemastery configuration for the user MCP bridge. */
export const Config: z<Config> = z.object({ path: z.string() })

interface Document {
  version: typeof DOCUMENT_VERSION
  servers: UserMcpServer[]
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) throw new Error(`${label} must be a non-empty string`)
  return value
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) throw new Error(`${label} must be an array of strings`)
  return [...value]
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  const row = object(value, label)
  if (!Object.values(row).every(entry => typeof entry === 'string')) throw new Error(`${label} values must be strings`)
  return Object.fromEntries(Object.entries(row).map(([key, entry]) => [key, entry as string]))
}

/**
 * Validate and detach one user MCP server value.
 * @param value - untrusted parsed or IPC value.
 * @returns one canonical persisted server.
 */
export function parseUserMcpServer(value: unknown): UserMcpServer {
  const row = object(value, 'MCP server')
  const serverName = string(row.serverName, 'MCP server name').trim()
  if (!SERVER_NAME.test(serverName)) throw new Error('MCP server name must match [A-Za-z0-9_-]{1,32}')
  if (row.transport === 'stdio') {
    return {
      transport: 'stdio', serverName,
      command: string(row.command, 'MCP command').trim(),
      args: row.args === undefined ? [] : stringArray(row.args, 'MCP args'),
      env: row.env === undefined ? {} : stringRecord(row.env, 'MCP env'),
      cwd: row.cwd === undefined ? '' : string(row.cwd, 'MCP cwd', true),
    }
  }
  if (row.transport === 'streamable-http') {
    const url = string(row.url, 'MCP URL').trim()
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('MCP URL must use HTTP or HTTPS')
    return {
      transport: 'streamable-http', serverName, url,
      headers: row.headers === undefined ? {} : stringRecord(row.headers, 'MCP headers'),
    }
  }
  throw new Error('MCP transport must be stdio or streamable-http')
}

function validateServers(values: unknown): UserMcpServer[] {
  if (!Array.isArray(values)) throw new Error('MCP servers must be an array')
  const servers = values.map(parseUserMcpServer)
  const names = new Set<string>()
  for (const server of servers) {
    if (names.has(server.serverName)) throw new Error(`Duplicate MCP server name: ${server.serverName}`)
    names.add(server.serverName)
  }
  return servers
}

/**
 * Resolve the user MCP document path.
 * @param configured - explicit plugin path.
 * @param env - environment used for `DSH_MCP_CONFIG_PATH` and `DSH_HOME`.
 * @returns an absolute JSON document path.
 */
export function resolveMcpConfigPath(
  configured?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const selected = configured ?? env.DSH_MCP_CONFIG_PATH
  if (selected === undefined || selected.trim() === '') return join(resolveDshHome(undefined, env), 'mcp-servers.json')
  return resolve(selected)
}

/**
 * Read and validate the user MCP document; absence means no configured servers.
 * @param path - resolved JSON document path.
 * @returns the detached, validated server list.
 */
export async function readUserMcpServers(path: string): Promise<UserMcpServer[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (missing(error)) return []
    throw error
  }
  const document = object(JSON.parse(text) as unknown, 'MCP configuration')
  if (document.version !== DOCUMENT_VERSION) throw new Error('Unsupported MCP configuration version')
  return validateServers(document.servers)
}

async function writeServers(path: string, servers: readonly UserMcpServer[]): Promise<void> {
  const document: Document = { version: DOCUMENT_VERSION, servers: [...servers] }
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Insert or replace one server under a cross-process writer lock.
 * @param path - resolved JSON document path.
 * @param value - complete server value.
 * @returns the committed server list.
 */
export async function upsertUserMcpServer(path: string, value: unknown): Promise<UserMcpServer[]> {
  const server = parseUserMcpServer(value)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    const current = await readUserMcpServers(path)
    const next = [...current.filter(candidate => candidate.serverName !== server.serverName), server]
      .sort((left, right) => left.serverName.localeCompare(right.serverName))
    await writeServers(path, next)
    return next
  })
}

/**
 * Remove one named server under a cross-process writer lock.
 * @param path - resolved JSON document path.
 * @param serverName - stable namespace to remove.
 * @returns the committed server list.
 */
export async function removeUserMcpServer(path: string, serverName: string): Promise<UserMcpServer[]> {
  const name = string(serverName, 'MCP server name').trim()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    const current = await readUserMcpServers(path)
    const next = current.filter(server => server.serverName !== name)
    await writeServers(path, next)
    return next
  })
}

/**
 * Redact credential values while retaining enough information for settings UI rows.
 * @param server - canonical persisted server.
 * @returns the redacted row.
 */
export function summarizeUserMcpServer(server: UserMcpServer): UserMcpServerSummary {
  return server.transport === 'stdio'
    ? {
      serverName: server.serverName, transport: server.transport,
      target: [server.command, ...server.args].join(' '), secretNames: Object.keys(server.env).sort(),
      command: server.command, args: server.args, cwd: server.cwd,
    }
    : {
      serverName: server.serverName, transport: server.transport,
      target: server.url, secretNames: Object.keys(server.headers).sort(), url: server.url,
    }
}

function clientConfig(server: UserMcpServer): McpClient.Config {
  return McpClient.Config(server as McpClient.Config)
}

class MountedServers {
  private readonly fibers = new Map<string, { fiber: Fiber; json: string }>()
  private servers: UserMcpServer[] = []

  constructor(private readonly ctx: Context, private readonly path: string) {}

  list(): readonly UserMcpServer[] { return this.servers }

  async reload(input?: UserMcpServer[]): Promise<void> {
    const servers = input ?? await readUserMcpServers(this.path)
    const wanted = new Map(servers.map(server => [server.serverName, server]))
    for (const [serverName, mounted] of [...this.fibers]) {
      if (wanted.has(serverName)) continue
      await mounted.fiber.dispose()
      this.fibers.delete(serverName)
    }
    for (const server of servers) {
      const json = JSON.stringify(server)
      const mounted = this.fibers.get(server.serverName)
      if (mounted === undefined) {
        const fiber = await this.ctx.plugin(McpClient, clientConfig(server))
        this.fibers.set(server.serverName, { fiber, json })
      } else if (mounted.json !== json) {
        await mounted.fiber.update(clientConfig(server), true)
        mounted.json = json
      }
    }
    this.servers = servers
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.fibers.values()].map(({ fiber }) => fiber.dispose()))
    this.fibers.clear()
  }
}

function parseJsonStrings(value: string | undefined, label: string): string[] {
  if (value === undefined || value.trim() === '') return []
  return stringArray(JSON.parse(value) as unknown, label)
}

function parseJsonRecord(value: string | undefined, label: string): Record<string, string> {
  if (value === undefined || value.trim() === '') return {}
  return stringRecord(JSON.parse(value) as unknown, label)
}

type ToolArgs = {
  action: 'list' | 'upsert' | 'remove'
  serverName?: string
  transport?: UserMcpServer['transport']
  command?: string
  argsJson?: string
  envJson?: string
  cwd?: string
  url?: string
  headersJson?: string
}

function serverFromTool(args: ToolArgs, existing: UserMcpServer | undefined): UserMcpServer {
  if (args.transport === 'stdio') return parseUserMcpServer({
    transport: args.transport, serverName: args.serverName,
    command: args.command ?? (existing?.transport === 'stdio' ? existing.command : undefined),
    args: args.argsJson === undefined && existing?.transport === 'stdio' ? existing.args : parseJsonStrings(args.argsJson, 'argsJson'),
    env: args.envJson === undefined && existing?.transport === 'stdio' ? existing.env : parseJsonRecord(args.envJson, 'envJson'),
    cwd: args.cwd ?? (existing?.transport === 'stdio' ? existing.cwd : ''),
  })
  if (args.transport === 'streamable-http') return parseUserMcpServer({
    transport: args.transport, serverName: args.serverName,
    url: args.url ?? (existing?.transport === 'streamable-http' ? existing.url : undefined),
    headers: args.headersJson === undefined && existing?.transport === 'streamable-http'
      ? existing.headers
      : parseJsonRecord(args.headersJson, 'headersJson'),
  })
  throw new Error('mcp_config: transport is required for upsert')
}

/**
 * Load persisted servers and register the `mcp_config` management tool.
 * @param ctx - plugin context carrying the tool registry and optional approval service.
 * @param config - document path override.
 * @returns startup readiness after configured clients settle their first connection attempt.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const path = resolveMcpConfigPath(config.path)
  const mounted = new MountedServers(ctx, path)
  await mounted.reload()
  ctx.effect(() => () => mounted.dispose(), 'mcp-user-config.servers')
  ctx.tools.register(defineTool({
    name: 'mcp_config',
    description: 'List, add, update, or remove persistent MCP servers. Use this when the user asks to configure MCP. Mutations require the user to approve once; successfully saved servers are available as mcp__<server>__<tool> tools in later work.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'upsert', 'remove'] },
      serverName: { type: 'string', description: 'Stable server namespace, [A-Za-z0-9_-], up to 32 characters.' },
      transport: { type: 'string', enum: ['stdio', 'streamable-http'] },
      command: { type: 'string', description: 'Executable for stdio.' },
      argsJson: { type: 'string', description: 'Stdio arguments as a JSON string array.' },
      envJson: { type: 'string', description: 'Stdio environment as a JSON object of string values.' },
      cwd: { type: 'string', description: 'Optional stdio working directory.' },
      url: { type: 'string', description: 'Streamable HTTP endpoint.' },
      headersJson: { type: 'string', description: 'HTTP headers as a JSON object of string values.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: ToolArgs, exec) {
      if (args.action === 'list') return { servers: mounted.list().map(summarizeUserMcpServer) } as unknown as Record<string, never>
      const existing = mounted.list().find(server => server.serverName === args.serverName)
      const candidate = args.action === 'upsert' ? serverFromTool(args, existing) : undefined
      const agent = exec.agent
      const approval = ctx.get('approval')
      if (agent === undefined || approval === undefined) throw new Error('mcp_config: mutations require an active approval provider')
      const serverName = string(args.serverName, 'MCP server name').trim()
      const outcome = await approval.request({
        agent, toolName: 'mcp_config', callId: exec.callId,
        reason: `${args.action === 'remove' ? 'Remove' : 'Save and activate'} MCP server ${serverName}.`,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') throw new Error(`mcp_config: ${args.action} was not approved`)
      const servers = args.action === 'remove'
        ? await removeUserMcpServer(path, serverName)
        : await upsertUserMcpServer(path, candidate)
      await mounted.reload(servers)
      return { servers: servers.map(summarizeUserMcpServer) } as unknown as Record<string, never>
    },
    presentCall: args => ({ card: 'generic', title: `MCP configuration: ${args.action}`, kind: 'execute', rawInput: JSON.stringify(args) }),
  }))
}
