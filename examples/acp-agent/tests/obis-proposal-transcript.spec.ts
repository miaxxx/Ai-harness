import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { launchAcpTestAgent } from '@deepseek-ai/dsh-acp-snapshot'
import { serializeObisBusinessReference } from '@deepseek-ai/dsh-obis-bridge'

it('confirms consecutive writes in one ACP chat with distinct governed Runs', async () => {
  const runs = new Map<string, { id: string; version: number; status: string; autonomy: string }>()
  const sessions: string[] = [], keys: Array<string | undefined> = []
  const respond = async (request: IncomingMessage, response: ServerResponse) => {
    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    const body = raw ? JSON.parse(raw) as { runId?: string; harnessSessionId?: string } : {}
    const send = (value: unknown, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (request.url === '/v1/agent-runs') {
      const id = `run-${runs.size + 1}`
      keys.push(request.headers['idempotency-key'] as string | undefined)
      const run = { id, version: 1, status: 'planning', autonomy: 'human-approved' }
      runs.set(id, run)
      send({ ...run, moduleBinding: { projectId: 'p', moduleId: 'assets', version: '1' } })
      return
    }
    const id = request.url?.match(/\/agent-runs\/(run-\d+)/)?.[1] ?? body.runId
    const run = id ? runs.get(id) : undefined
    if (!run) { send({ error: 'Unknown governed Run' }, 404); return }
    if (request.url?.endsWith('/attach')) {
      sessions.push(body.harnessSessionId ?? '')
      send({ ...run, capabilityLease: { id: `lease-${id}` } })
    } else if (request.url?.includes('/actions/Asset.create/propose')) {
      if (run.status === 'completed') { send({ error: 'Run is completed' }, 409); return }
      run.version = 2
      send({ run, proposal: { id: `proposal-${id}`, decision: { allowed: true } } })
    } else if (request.url?.endsWith('/execute')) {
      run.version = 3
      run.status = 'completed'
      send({ run, result: { status: 'executed' } })
    } else send(run)
  }
  const server = createServer((request, response) => {
    void respond(request, response).catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error(String(error))))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected HTTP test address')
  const cwd = await mkdtemp(join(tmpdir(), 'obis-acp-proposals-'))
  let confirmations = 0
  const agent = launchAcpTestAgent({ cwd,
    agent: {
      binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
      configPath: fileURLToPath(new URL('./fixtures/obis/proposal-repeat/cordis.yml', import.meta.url)),
      tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    },
    env: { DSH_HOME: cwd, OBIS_RUNTIME_BASE_URL: `http://127.0.0.1:${address.port}`, OBIS_DELEGATED_ACCESS_TOKEN: 'private-token' },
    requestPermission(params) {
      confirmations++
      const option = params.options.find(candidate => candidate.kind === 'allow_once')
      if (!option) return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      return Promise.resolve({ outcome: { outcome: 'selected', optionId: option.optionId } })
    },
  })
  try {
    await agent.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await agent.client.newSession({ cwd, mcpServers: [] })
    const ref = serializeObisBusinessReference({
      kind: 'module', projectId: 'p', environmentId: 'test', label: '设备', moduleId: 'assets', moduleVersion: '1', pageId: 'home',
    })
    for (const text of [`First write ${ref}`, 'Second write']) {
      const result = await agent.client.prompt({ sessionId, prompt: [{ type: 'text', text }] })
      expect(result.stopReason, agent.stderr()).toBe('end_turn')
    }
    expect([...runs.values()].map(run => run.status)).toEqual(['completed', 'completed'])
    expect(new Set(keys).size).toBe(2)
    expect(new Set(sessions).size).toBe(1)
    expect(confirmations).toBe(2)
    const text = agent.updates.flatMap(update =>
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []).join('\n')
    expect(text).toMatchInlineSnapshot('"OBIS confirmed write completed.\nOBIS confirmed write completed."')
    expect(agent.rawStdout()).not.toMatch(/private-token|lease-run-/)
  } finally {
    await agent.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    await rm(cwd, { recursive: true, force: true })
  }
}, 30_000)
