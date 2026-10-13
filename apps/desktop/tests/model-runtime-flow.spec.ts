import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { connectAcpRuntime } from '@deepseek-ai/dsh-acp-client'

it('sends declared output and reasoning through the assembled Desktop ACP configuration', async () => {
  const requests: Array<Record<string, unknown>> = []
  const server = createServer((request, response) => {
    let input = ''
    request.on('data', (chunk) => { input += String(chunk) })
    request.on('end', () => {
      requests.push(JSON.parse(input) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const frame = (delta: object, finish_reason: string | null): string => `data: ${JSON.stringify({ id: 'test-completion', object: 'chat.completion.chunk', model: 'work-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      response.end(frame({ role: 'assistant', content: 'PONG' }, null) + frame({}, 'stop') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test server address')
  const cwd = await mkdtemp(join(tmpdir(), 'mona-model-flow-'))
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  const transcript: string[] = []
  const spec = {
    command: process.execPath,
    args: ['--import', fileURLToPath(import.meta.resolve('tsx/esm')), resolve(repository, 'packages/examples/acp-demo/src/bin.ts'), '--config', resolve(repository, 'examples/acp-agent/cordis.yml')],
    cwd,
    env: {
      TSX_TSCONFIG_PATH: join(repository, 'tsconfig.json'), DSH_HOME: join(cwd, 'home'), DSH_AGENTS_HOME: join(cwd, 'agents'),
      DSH_DESKTOP_MODEL_ENABLED: 'true', DSH_DESKTOP_MODEL_API: 'openai-completions', DSH_DESKTOP_MODEL_ID: 'work-model',
      DSH_DESKTOP_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`, DSH_DESKTOP_MODEL_API_KEY: 'test-key',
      DSH_DESKTOP_MODEL_CONTEXT_WINDOW: '1048576', DSH_DESKTOP_MODEL_MAX_OUTPUT_TOKENS: '1536',
      DSH_DESKTOP_MODEL_REASONING: 'high', DSH_DESKTOP_MODEL_REASONING_EFFORTS: JSON.stringify({ off: null, high: 'high' }),
      DSH_DESKTOP_DIAGNOSTICS_ENABLED: 'true', DSH_PERMISSION_MODE: 'workspace-write',
      DSH_DESKTOP_NPM_CACHE: join(cwd, 'Mona', 'cache', 'npm'),
      DSH_SNAPSHOT_SESSIONS_ROOT: join(cwd, 'sessions'),
    },
  }
  const handlers: Parameters<typeof connectAcpRuntime>[1] = { onSessionUpdate(notification) {
    const update = notification.update
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') transcript.push(update.content.text)
  } }
  let runtime = await connectAcpRuntime(spec, handlers)
  try {
    const session = await runtime.client.newSession({ cwd, mcpServers: [] })
    const result = await runtime.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply with exactly the word: PONG. Do not use any tools.' }] })
    expect(requests).toHaveLength(1)
    const wire = requests[0]!
    if (process.platform === 'win32') expect(JSON.stringify(wire.messages)).not.toContain('Additional writable directories:')
    else {
      expect(JSON.stringify(wire.messages)).toContain('Additional writable directories:')
      expect(JSON.stringify(wire.messages)).toContain('cache/npm')
    }
    expect(wire).toMatchObject({ model: 'work-model', max_completion_tokens: 1536, reasoning_effort: 'high' })
    await runtime.dispose()
    const { DSH_DESKTOP_MODEL_REASONING: _oldReasoning, ...automatic } = spec.env
    runtime = await connectAcpRuntime({ ...spec, env: { ...automatic, DSH_DESKTOP_MODEL_ID: 'auto-model', DSH_DESKTOP_MODEL_REASONING: '', DSH_DESKTOP_MODEL_MAX_OUTPUT_TOKENS: '2048', DSH_DESKTOP_MODEL_REASONING_EFFORTS: 'false' } }, handlers)
    await runtime.client.loadSession({ sessionId: session.sessionId, cwd, mcpServers: [] })
    transcript.length = 0
    const next = await runtime.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply PONG again.' }] })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ model: 'auto-model', max_completion_tokens: 2048 })
    expect(requests[1]).not.toHaveProperty('reasoning_effort')
    expect(JSON.stringify(requests[1]?.messages)).toContain('Reply with exactly the word: PONG')
    expect({ reply: transcript.join(''), firstOutcome: result.stopReason, nextOutcome: next.stopReason,
      firstModel: wire.model, nextModel: requests[1]?.model, maxOutput: requests[1]?.max_completion_tokens, reasoning: requests[1]?.reasoning_effort ?? 'auto', requests: requests.length, cacheGrant: 'workspace-write' }).toMatchInlineSnapshot(`
      {
        "cacheGrant": "workspace-write",
        "firstModel": "work-model",
        "firstOutcome": "end_turn",
        "maxOutput": 2048,
        "nextModel": "auto-model",
        "nextOutcome": "end_turn",
        "reasoning": "auto",
        "reply": "PONG",
        "requests": 2,
      }
    `)
  } finally {
    await runtime.dispose()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    await rm(cwd, { recursive: true, force: true })
  }
}, 30000)
