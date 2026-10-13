import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { connectAcpRuntime } from '@deepseek-ai/dsh-acp-client'
import { DesktopDiagnostics } from '../src/diagnostics/main/diagnostics.ts'

it('records an assembled keyless ACP request through the real Loader and reopens its evidence', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'mona-diagnostic-runtime-'))
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  const diagnostics = new DesktopDiagnostics(join(cwd, 'logs'), (error) => { throw error })
  let messageId = ''
  const runtime = await connectAcpRuntime({
    command: process.execPath,
    args: ['--import', fileURLToPath(import.meta.resolve('tsx/esm')), resolve(repository, 'packages/examples/acp-demo/src/bin.ts'), '--config', resolve(repository, 'examples/acp-agent/cordis.yml')],
    cwd,
    env: {
      TSX_TSCONFIG_PATH: join(repository, 'tsconfig.json'), DSH_SNAPSHOT: 'replay',
      DSH_SNAPSHOT_FILE: join(repository, 'examples/acp-agent/tests/snapshots/text-turn/session.jsonl'),
      DSH_SNAPSHOT_SESSIONS_ROOT: join(cwd, 'sessions'), DSH_HOME: join(cwd, 'home'),
      DSH_AGENTS_HOME: join(cwd, 'agents'), DSH_DESKTOP_DIAGNOSTICS_ENABLED: 'true',
    },
  }, { onSessionUpdate: (notification) => {
    diagnostics.record(notification.sessionId, 'session-update', notification)
    if (notification.update.sessionUpdate === 'user_message_chunk') messageId = notification.update.messageId ?? ''
  } })
  try {
    const session = await runtime.client.newSession({ cwd, mcpServers: [] })
    const log = diagnostics.begin(session.sessionId, { cwd })
    const result = await runtime.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply with exactly the word: PONG. Do not use any tools.' }] })
    await diagnostics.finish(session.sessionId, log, 'completed', result)
    expect(messageId).not.toBe('')
    const path = await new DesktopDiagnostics(join(cwd, 'logs'), (error) => { throw error }).find(session.sessionId, messageId)
    const records = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as {
      data?: { update?: { _meta?: { harnessDiagnostics?: {
        kind: string
        data: { system?: string; tools?: unknown[]; messages?: unknown; type?: string }
      } } } }
    })
    const evidence = records.flatMap((record) => {
      const item = record.data?.update?._meta?.harnessDiagnostics
      return item === undefined ? [] : [item]
    })
    const request = evidence.find(item => item.kind === 'model-request')
    expect(request?.data.system).toContain('coding assistant')
    expect(request?.data.tools?.length).toBeGreaterThan(0)
    expect(JSON.stringify(request?.data.messages)).toContain('PONG')
    expect({ outcome: result.stopReason, requestRecorded: Boolean(request), durableTurnEnd: evidence.some(item => item.data.type === 'turn/end'), reopened: path === log.path }).toMatchInlineSnapshot(`
      {
        "durableTurnEnd": true,
        "outcome": "end_turn",
        "reopened": true,
        "requestRecorded": true,
      }
    `)
  } finally {
    await diagnostics.shutdown()
    await runtime.dispose()
    await rm(cwd, { recursive: true, force: true })
  }
}, 30_000)
