import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as UserConfig from '@deepseek-ai/dsh-mcp-user-config'

const roots: string[] = []
const contexts: Context[] = []
const signal = new AbortController().signal

async function temporary(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-mcp-user-config-'))
  roots.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function context(path: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserConfig, { path })
  return ctx
}

function execute(ctx: Context, arguments_: Record<string, unknown>, withAgent = false) {
  return ctx.tools.execute({
    name: 'mcp_config', arguments: arguments_, signal, callId: 'mcp-config-test' as never,
    ...(withAgent ? { agent: { id: 'agent' } as never } : {}),
  })
}

describe('user MCP configuration', () => {
  it('validates both transports and rejects unsafe names or URLs', () => {
    expect(UserConfig.parseUserMcpServer({
      transport: 'stdio', serverName: 'files', command: 'npx', args: ['server'], env: {}, cwd: '',
    })).toMatchObject({ transport: 'stdio', serverName: 'files' })
    expect(UserConfig.parseUserMcpServer({
      transport: 'streamable-http', serverName: 'search', url: 'https://example.com/mcp', headers: {},
    })).toMatchObject({ transport: 'streamable-http', serverName: 'search' })
    expect(() => UserConfig.parseUserMcpServer({ transport: 'stdio', serverName: 'bad name', command: 'x' })).toThrow()
    expect(() => UserConfig.parseUserMcpServer({ transport: 'streamable-http', serverName: 'x', url: 'file:///tmp/mcp' })).toThrow()
    expect(() => UserConfig.parseUserMcpServer(null)).toThrow('must be an object')
    expect(() => UserConfig.parseUserMcpServer({ transport: 'stdio', serverName: 'x', command: '' })).toThrow('non-empty string')
    expect(() => UserConfig.parseUserMcpServer({ transport: 'stdio', serverName: 'x', command: 'x', args: [1] })).toThrow('array of strings')
    expect(() => UserConfig.parseUserMcpServer({ transport: 'stdio', serverName: 'x', command: 'x', env: [] })).toThrow('must be an object')
    expect(() => UserConfig.parseUserMcpServer({ transport: 'stdio', serverName: 'x', command: 'x', env: { X: 1 } })).toThrow('values must be strings')
    expect(() => UserConfig.parseUserMcpServer({ transport: 'streamable-http', serverName: 'x', url: 'not a url' })).toThrow()
    expect(() => UserConfig.parseUserMcpServer({ transport: 'other', serverName: 'x' })).toThrow('transport')
    expect(UserConfig.parseUserMcpServer({ transport: 'stdio', serverName: 'x', command: ' x ' })).toEqual({
      transport: 'stdio', serverName: 'x', command: 'x', args: [], env: {}, cwd: '',
    })
    expect(UserConfig.parseUserMcpServer({ transport: 'streamable-http', serverName: 'x', url: 'https://example.com' })).toEqual({
      transport: 'streamable-http', serverName: 'x', url: 'https://example.com', headers: {},
    })
  })

  it('resolves explicit, environment, and harness-home document paths', () => {
    expect(UserConfig.resolveMcpConfigPath('./chosen.json', {})).toBe(resolve('chosen.json'))
    expect(UserConfig.resolveMcpConfigPath(undefined, { DSH_MCP_CONFIG_PATH: './environment.json' })).toBe(resolve('environment.json'))
    expect(UserConfig.resolveMcpConfigPath(undefined, { DSH_MCP_CONFIG_PATH: '', DSH_HOME: '/tmp/dsh-test-home' })).toBe('/tmp/dsh-test-home/mcp-servers.json')
  })

  it('fails loud on malformed documents and filesystem errors', async () => {
    const root = await temporary()
    const path = join(root, 'mcp.json')
    await writeFile(path, '{')
    await expect(UserConfig.readUserMcpServers(path)).rejects.toThrow()
    await writeFile(path, '[]')
    await expect(UserConfig.readUserMcpServers(path)).rejects.toThrow('must be an object')
    await writeFile(path, JSON.stringify({ version: 2, servers: [] }))
    await expect(UserConfig.readUserMcpServers(path)).rejects.toThrow('Unsupported')
    await writeFile(path, JSON.stringify({ version: 1, servers: {} }))
    await expect(UserConfig.readUserMcpServers(path)).rejects.toThrow('must be an array')
    await writeFile(path, JSON.stringify({
      version: 1,
      servers: [
        { transport: 'stdio', serverName: 'same', command: 'one' },
        { transport: 'stdio', serverName: 'same', command: 'two' },
      ],
    }))
    await expect(UserConfig.readUserMcpServers(path)).rejects.toThrow('Duplicate')
    await mkdir(join(root, 'directory'))
    await expect(UserConfig.readUserMcpServers(join(root, 'directory'))).rejects.toThrow()
  })

  it('atomically upserts and removes servers while keeping secrets out of summaries', async () => {
    const path = join(await temporary(), 'mcp-servers.json')
    await UserConfig.upsertUserMcpServer(path, {
      transport: 'stdio', serverName: 'files', command: 'npx', args: ['server'], env: { TOKEN: 'secret' }, cwd: '',
    })
    await UserConfig.upsertUserMcpServer(path, {
      transport: 'streamable-http', serverName: 'search', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret' },
    })
    const servers = await UserConfig.readUserMcpServers(path)
    expect(servers.map(server => server.serverName)).toEqual(['files', 'search'])
    expect(UserConfig.summarizeUserMcpServer(servers[1]!)).toMatchObject({
      serverName: 'search', secretNames: ['Authorization'],
    })
    expect(UserConfig.summarizeUserMcpServer(servers[0]!)).toEqual({
      serverName: 'files', transport: 'stdio', target: 'npx server', secretNames: ['TOKEN'],
      command: 'npx', args: ['server'], cwd: '',
    })
    expect(JSON.stringify(UserConfig.summarizeUserMcpServer(servers[1]!))).not.toContain('Bearer secret')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })
    await UserConfig.removeUserMcpServer(path, 'files')
    expect((await UserConfig.readUserMcpServers(path)).map(server => server.serverName)).toEqual(['search'])
    await UserConfig.upsertUserMcpServer(path, {
      transport: 'streamable-http', serverName: 'search', url: 'https://changed.example/mcp', headers: {},
    })
    expect((await UserConfig.readUserMcpServers(path))[0]).toMatchObject({ url: 'https://changed.example/mcp' })
    await expect(UserConfig.removeUserMcpServer(path, '  ')).rejects.toThrow('non-empty string')
  })

  it('serializes concurrent writers so sibling servers survive', async () => {
    const path = join(await temporary(), 'mcp-servers.json')
    await Promise.all([
      UserConfig.upsertUserMcpServer(path, { transport: 'stdio', serverName: 'a', command: 'a' }),
      UserConfig.upsertUserMcpServer(path, { transport: 'stdio', serverName: 'b', command: 'b' }),
    ])
    expect((await UserConfig.readUserMcpServers(path)).map(server => server.serverName)).toEqual(['a', 'b'])
  })

  it('registers the management tool when the document is absent', async () => {
    const root = await temporary()
    const ctx = await context(join(root, 'missing.json'))
    const tool = ctx.tools.get('mcp_config')!
    expect(tool).toBeDefined()
    expect(tool.output.render({}, { ok: true })).toEqual([{ type: 'text', text: '{\n  "ok": true\n}' }])
    expect(tool.presentCall?.({ action: 'list' })).toMatchObject({ title: 'MCP configuration: list' })
    const result = await execute(ctx, { action: 'list' })
    expect(result).toMatchObject({ isError: false, value: { servers: [] } })
  })

  it('requires an active approved mutation and preserves omitted credentials', async () => {
    const path = join(await temporary(), 'mcp.json')
    const ctx = await context(path)
    await expect(execute(ctx, { action: 'upsert', transport: 'other', serverName: 'x' })).resolves.toMatchObject({ isError: true })
    await expect(execute(ctx, { action: 'upsert', transport: 'stdio', serverName: 'x', command: 'missing-command' })).resolves.toMatchObject({ isError: true })

    vi.spyOn(ctx, 'get').mockReturnValue({ request: vi.fn().mockResolvedValue('rejected') })
    await expect(execute(ctx, { action: 'remove', serverName: 'x' }, true)).resolves.toMatchObject({ isError: true })

    const request = vi.fn().mockResolvedValue('allowed-once')
    vi.spyOn(ctx, 'get').mockReturnValue({ request })
    const created = await execute(ctx, {
      action: 'upsert', transport: 'stdio', serverName: 'files', command: '/definitely/missing-mcp',
      argsJson: '["one"]', envJson: '{"TOKEN":"secret"}', cwd: '/tmp',
    }, true)
    expect(created).toMatchObject({ isError: false })
    expect(request).toHaveBeenCalled()

    const unchanged = await execute(ctx, {
      action: 'upsert', transport: 'stdio', serverName: 'files',
    }, true)
    expect(unchanged).toMatchObject({ isError: false })

    const updated = await execute(ctx, {
      action: 'upsert', transport: 'stdio', serverName: 'files', command: '/still/missing-mcp',
    }, true)
    expect(updated).toMatchObject({ isError: false })
    expect((await UserConfig.readUserMcpServers(path))[0]).toMatchObject({ args: ['one'], env: { TOKEN: 'secret' }, cwd: '/tmp' })

    await execute(ctx, { action: 'remove', serverName: 'files' }, true)
    expect(await UserConfig.readUserMcpServers(path)).toEqual([])
  })

  it('configures HTTP servers and rejects malformed tool JSON', async () => {
    const path = join(await temporary(), 'mcp.json')
    const ctx = await context(path)
    vi.spyOn(ctx, 'get').mockReturnValue({ request: vi.fn().mockResolvedValue('allowed-once') })

    await expect(execute(ctx, {
      action: 'upsert', transport: 'stdio', serverName: 'bad-args', command: 'missing', argsJson: '{}',
    }, true)).resolves.toMatchObject({ isError: true })
    await expect(execute(ctx, {
      action: 'upsert', transport: 'streamable-http', serverName: 'bad-headers', url: 'https://example.com/mcp', headersJson: '[]',
    }, true)).resolves.toMatchObject({ isError: true })
    await expect(execute(ctx, {
      action: 'upsert', serverName: 'missing-transport',
    }, true)).resolves.toMatchObject({ isError: true })

    await execute(ctx, {
      action: 'upsert', transport: 'streamable-http', serverName: 'remote', url: 'https://example.com/mcp', headersJson: '{"Authorization":"secret"}',
    }, true)
    await execute(ctx, {
      action: 'upsert', transport: 'streamable-http', serverName: 'remote', url: 'https://example.com/next',
    }, true)
    expect((await UserConfig.readUserMcpServers(path))[0]).toMatchObject({ headers: { Authorization: 'secret' }, url: 'https://example.com/next' })
    await expect(execute(ctx, {
      action: 'upsert', transport: 'stdio', serverName: 'remote',
    }, true)).resolves.toMatchObject({ isError: true })

    await execute(ctx, {
      action: 'upsert', transport: 'streamable-http', serverName: 'remote',
    }, true)

    await execute(ctx, {
      action: 'upsert', transport: 'streamable-http', serverName: 'remote', url: 'https://example.com/empty', headersJson: '',
    }, true)
    expect((await UserConfig.readUserMcpServers(path))[0]).toMatchObject({ headers: {} })

    await execute(ctx, {
      action: 'upsert', transport: 'stdio', serverName: 'local', command: '/definitely/missing-local',
    }, true)
    await expect(execute(ctx, {
      action: 'upsert', transport: 'streamable-http', serverName: 'local',
    }, true)).resolves.toMatchObject({ isError: true })
  })

  it('rejects mutations when the approval provider is unavailable', async () => {
    const ctx = await context(join(await temporary(), 'mcp.json'))
    vi.spyOn(ctx, 'get').mockReturnValue(undefined)
    await expect(execute(ctx, { action: 'remove', serverName: 'x' }, true)).resolves.toMatchObject({ isError: true })
  })
})
