import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import { connectAcpRuntime, type AcpRuntimeConnection } from '@deepseek-ai/dsh-acp-client'
import { expect, it } from 'vitest'

it('uses gateway reasoning defaults and preserves history across a real model Runtime restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-model-runtime-'))
  const requests: Array<{ model: string; reasoning_effort?: string; messages: unknown[] }> = []
  const updates: SessionNotification[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const value = JSON.parse(body) as typeof requests[number]
      requests.push(value)
      if (value.reasoning_effort !== undefined) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'reasoning_effort is unsupported' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'gateway-test', object: 'chat.completion.chunk', choices: [
        { index: 0, delta: { role: 'assistant', content: 'Gateway default accepted.' }, finish_reason: 'stop' },
      ] })}\n\ndata: [DONE]\n\n`)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Gateway did not listen')
  let runtime: AcpRuntimeConnection | undefined
  const launch = (model: string): Promise<AcpRuntimeConnection> => connectAcpRuntime({
    command: process.execPath,
    args: [fileURLToPath(new URL('../../../packages/examples/acp-demo/lib/bin.js', import.meta.url)),
      '--config', fileURLToPath(new URL('../../../examples/acp-agent/cordis.yml', import.meta.url))],
    cwd: root,
    env: {
      DSH_DESKTOP_MODEL_ENABLED: 'true', DSH_DESKTOP_MODEL_API: 'openai-completions',
      DSH_DESKTOP_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`, DSH_DESKTOP_MODEL_ID: model,
      DSH_DESKTOP_MODEL_API_KEY: 'test-gateway-key', DSH_DESKTOP_MODEL_INPUT: 'text',
      DSH_DESKTOP_CODE_WORK_ENABLED: 'true', DSH_DESKTOP_COMPUTER_USE_ENABLED: 'false',
      DSH_SNAPSHOT_SESSIONS_ROOT: join(root, 'sessions'),
    },
  }, { onSessionUpdate: (update) => { updates.push(update) }, onRuntimeStderr: () => {} })
  try {
    runtime = await launch('gpt-5.6-sol')
    const { sessionId } = await runtime.client.newSession({ cwd: root, mcpServers: [] })
    await runtime.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Reply with a short greeting.' }] })
    await runtime.dispose()
    runtime = await launch('gpt-5.6-luna')
    await runtime.client.loadSession({ sessionId, cwd: root, mcpServers: [] })
    await runtime.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Reply again.' }] })
    expect(requests.map(request => request.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna'])
    expect(requests.every(request => request.reasoning_effort === undefined)).toBe(true)
    expect(JSON.stringify(requests[1]?.messages)).toContain('Gateway default accepted.')
    const visibleReplies = updates.flatMap(({ update }) => update.sessionUpdate === 'agent_message_chunk'
      && update.content.type === 'text' ? [update.content.text] : [])
    expect(visibleReplies).toMatchInlineSnapshot(`
      [
        "Gateway default accepted.",
        "Gateway default accepted.",
        "Gateway default accepted.",
      ]
    `)
  } finally {
    await runtime?.dispose()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
