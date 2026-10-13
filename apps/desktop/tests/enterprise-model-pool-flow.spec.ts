import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => native.root }, BrowserWindow: vi.fn(), dialog: { showMessageBox: vi.fn() } }))
import { DesktopRuntimePool } from '../src/runtime/main/pool.ts'
import { AcpRuntimeSupervisor } from '../src/runtime/main/supervisor.ts'
import { DesktopContentStore } from '../src/desktop-content.ts'
import { DesktopDiagnostics } from '../src/diagnostics/main/diagnostics.ts'
import { setEnterpriseRuntimeScope, enterpriseRuntimeScope } from '../src/desktop-enterprise-scope-main.ts'
import type { BrowserWindow } from 'electron'
import type { DesktopRendererFrame } from '../src/shared.ts'
import type { StoredModelSettings } from '../src/desktop-model-storage.ts'
import type { DesktopRuntimeCredentialLifetime } from '../src/desktop-runtime-credential.ts'

it('switches a real enterprise-owned ACP session, renews its credential, and rejects it after a tenant change', async () => {
  native.root = await mkdtemp(join(tmpdir(), 'orbis-enterprise-pool-'))
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  const scope = { tenantId: 'tenant-one', projectId: 'project', environmentId: 'test', userId: 'user', installationId: 'installation' }
  setEnterpriseRuntimeScope(scope)
  const content = new DesktopContentStore(join(native.root, 'skills'), () => join(repository, 'apps/cli/config/skills'), enterpriseRuntimeScope)
  const diagnostics = new DesktopDiagnostics(join(native.root, 'logs'), (error) => { throw error })
  const requests: Array<{ model: string; messages: unknown[]; tools: Array<{ function: { name: string } }> }> = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => { text += String(chunk) })
    request.on('end', () => {
      requests.push(JSON.parse(text) as typeof requests[number])
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Enterprise model reply.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing model address')
  let selected: StoredModelSettings = { version: 4, id: 'one', model: 'one', protocol: 'openai-completions', baseURL: `http://127.0.0.1:${address.port}/v1`, encryptedApiKey: 'encrypted', computerUseEnabled: false, capabilities: { input: ['text'], verified: true, contextWindow: 32768 } }
  const lifetimes: DesktopRuntimeCredentialLifetime[] = []
  const pool = new DesktopRuntimePool(async () => selected, snapshot => new AcpRuntimeSupervisor(async (lifetime) => {
    lifetimes.push(lifetime)
    lifetime.setExpiry(new Date(Date.now() + 60_000).toISOString())
    return {
      command: process.execPath,
      args: ['--import', fileURLToPath(import.meta.resolve('tsx/esm')), resolve(repository, 'packages/examples/acp-demo/src/bin.ts'), '--config', resolve(repository, 'examples/acp-agent/cordis.yml')],
      cwd: native.root,
      env: {
        TSX_TSCONFIG_PATH: join(repository, 'tsconfig.json'), DSH_HOME: join(native.root, 'home'), DSH_AGENTS_HOME: join(native.root, 'agents'),
        DSH_SNAPSHOT_SESSIONS_ROOT: join(native.root, 'sessions'),
        DSH_DESKTOP_MODEL_ENABLED: 'true', DSH_DESKTOP_MODEL_ID: snapshot!.model,
        DSH_DESKTOP_MODEL_BASE_URL: selected.baseURL, DSH_DESKTOP_MODEL_API_KEY: 'test-key', DSH_DESKTOP_MODEL_CONTEXT_WINDOW: '32768',
        DSH_DESKTOP_DIAGNOSTICS_ENABLED: 'true', DSH_PERMISSION_MODE: 'workspace-write',
        OBIS_DELEGATED_ACCESS_TOKEN: 'test-delegated-token', OBIS_RUNTIME_BASE_URL: 'http://127.0.0.1:9',
        OBIS_ENVIRONMENT_ID: scope.environmentId, OBIS_PROJECT_ID: scope.projectId, OBIS_INSTALLATION_ID: scope.installationId,
      },
    }
  }, snapshot, () => content, () => diagnostics, () => native.root), () => native.root, (oldId, nextId) => {
    content.transferDraftAttachments(oldId, nextId)
  })
  const frames: DesktopRendererFrame[] = []
  pool.attachWindow({ isDestroyed: () => false, webContents: { isDestroyed: () => false,
    send: (_channel: string, frame: DesktopRendererFrame) => { frames.push(frame) },
  } } as unknown as BrowserWindow)
  try {
    const original = await pool.createSession()
    selected = { ...selected, id: 'two', model: 'two' }
    const empty = await pool.prepareSession(original)
    expect(empty).not.toBe(original)
    expect((await pool.prompt(empty, [{ type: 'text', text: 'Say hello without calling tools.' }])).stopReason).toBe('end_turn')
    lifetimes.at(-1)!.setExpiry(new Date(0).toISOString())
    await pool.prepareSession(empty)
    await pool.prompt(empty, [{ type: 'text', text: 'Reply after renewal.' }])
    selected = { ...selected, id: 'three', model: 'three' }
    await pool.prepareSession(empty)
    await pool.prompt(empty, [{ type: 'text', text: 'Reply after model selection.' }])
    expect(requests.map(item => item.model)).toEqual(['two', 'two', 'three'])
    expect(JSON.stringify(requests[2]!.messages)).toContain('Enterprise model reply.')
    expect(requests.every(item => item.tools.some(tool => tool.function.name === 'obis_context'))).toBe(true)
    expect(JSON.stringify(requests)).not.toContain('test-delegated-token')
    expect(frames.filter(frame => frame.type === 'runtime-status' && !frame.preserveSessions)).toEqual([])
    setEnterpriseRuntimeScope({ ...scope, tenantId: 'tenant-two' })
    await pool.invalidate(true)
    await expect(pool.prepareSession(empty)).rejects.toThrow('Enterprise session access denied')
    expect(requests).toHaveLength(3)
    setEnterpriseRuntimeScope(undefined)
    await pool.invalidate(true)
    await expect(pool.prepareSession(empty)).rejects.toThrow('Enterprise session access denied')
    expect({ models: requests.map(item => item.model), enterpriseToolsPreserved: true, historyPreserved: true, crossTenantRejected: true }).toMatchInlineSnapshot(`
      {
        "crossTenantRejected": true,
        "enterpriseToolsPreserved": true,
        "historyPreserved": true,
        "models": [
          "two",
          "two",
          "three",
        ],
      }
    `)
  } finally {
    await pool.stop(); await diagnostics.shutdown(); setEnterpriseRuntimeScope(undefined)
    server.closeAllConnections()
    await new Promise<void>(done => server.close(() => { done() }))
    await rm(native.root, { recursive: true, force: true })
  }
}, 120_000)
