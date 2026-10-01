import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { launchAcpTestAgent } from '@deepseek-ai/dsh-acp-snapshot'
import { DesktopRuntimeCredentialLifetime } from '../../../apps/desktop/src/desktop-runtime-credential.ts'
import { serializeObisBusinessReference } from '@deepseek-ai/dsh-obis-bridge'

it('replays the public event read through a runnable ACP composition', async () => {
  const requests: Array<{ url: string | undefined; lease: string | string[] | undefined; token: string | undefined }> = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, lease: request.headers['ohp-capability-lease'], token: request.headers.authorization })
    if (!request.url?.includes('/events?')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'run', version: 1, autonomy: 'read-only', moduleBinding: { projectId: 'p', moduleId: 'supplier', version: '1' }, capabilityLease: { id: 'private-lease' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'event-2', type: 'query.completed', runId: 'run', occurredAt: '2026-10-01T00:00:00Z', correlationId: 'corr-query', payload: {} })}\n\n`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected HTTP test address')
  const cwd = await mkdtemp(join(tmpdir(), 'obis-acp-transcript-'))
  const launch = (token: string) => launchAcpTestAgent({ cwd,
    agent: {
      binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
      configPath: fileURLToPath(new URL('./fixtures/obis/tool-obis/cordis.yml', import.meta.url)),
      tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    },
    env: { DSH_HOME: cwd, OBIS_RUNTIME_BASE_URL: `http://127.0.0.1:${address.port}`, OBIS_DELEGATED_ACCESS_TOKEN: token },
  })
  let agent = launch('private-token')
  try {
    await agent.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await agent.client.newSession({ cwd, mcpServers: [] })
    const reference = serializeObisBusinessReference({ kind: 'module', projectId: 'p', environmentId: 'test', label: '供应商', moduleId: 'supplier', moduleVersion: '1', pageId: 'home' })
    const result = await agent.client.prompt({ sessionId, prompt: [{ type: 'text', text: `Read one public event.${reference}` }] })
    expect(result.stopReason, agent.stderr()).toBe('end_turn')
    expect(requests.map(request => request.url)).toEqual(['/v1/agent-runs/run?environmentId=test', '/v1/agent-runs/run/attach', '/v1/agent-runs/run/events?environmentId=test&after=event-1'])
    expect(requests.at(-1)).toEqual({ url: '/v1/agent-runs/run/events?environmentId=test&after=event-1', lease: 'private-lease', token: 'Bearer private-token' })
    const text = agent.updates.flatMap(update => update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []).join('')
    expect(text).toMatchInlineSnapshot('"Kernel SSE: query.completed (event-2)"')
    expect(agent.rawStdout()).not.toMatch(/private-token|private-lease/)
    const lifetime = new DesktopRuntimeCredentialLifetime()
    lifetime.setExpiry(new Date(Date.now() - 1).toISOString())
    let replayCount = 0
    const renewed = await lifetime.run(async () => {
      await agent.close()
      agent = launch('private-token-renewed')
      await agent.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      await agent.client.loadSession({ sessionId, cwd, mcpServers: [] })
      expect(agent.updates.some(update => update.sessionUpdate === 'agent_message_chunk')).toBe(true)
      replayCount = agent.updates.length
      lifetime.setExpiry(new Date(Date.now() + 60_000).toISOString())
    }, () => agent.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Read one public event after renewal.' }] }))
    expect(renewed.stopReason, agent.stderr()).toBe('end_turn')
    expect(requests.at(-1)?.token).toBe('Bearer private-token-renewed')
    const renewedText = agent.updates.slice(replayCount).flatMap(update => update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []).join('')
    expect({ initial: text, renewed: renewedText }).toMatchInlineSnapshot(`
      {
        "initial": "Kernel SSE: query.completed (event-2)",
        "renewed": "Kernel SSE: query.completed (event-2)",
      }
    `)
    expect(agent.rawStdout()).not.toMatch(/private-token|private-lease/)

  } finally {
    await agent.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    await rm(cwd, { recursive: true, force: true })
  }
}, 30_000)
