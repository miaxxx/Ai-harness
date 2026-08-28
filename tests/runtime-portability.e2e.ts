import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '../packages/session/session-persistence-jsonl/src/index.ts'
import SqliteSessionPersistence from '../packages/session/session-persistence-sqlite/src/index.ts'
import { makeBridgeHarness, textResponse, type BridgeHarness } from '../packages/acp/acp/tests/harness.ts'

interface BackendCase {
  name: string
  mount(root: string): (ctx: Context) => Promise<void>
}

const backends: BackendCase[] = [
  {
    name: 'JSONL',
    mount: root => async (ctx) => {
      await ctx.plugin(JsonlSessionPersistence, {
        root: join(root, 'jsonl'),
        compression: 'none',
        writeBatchMaxDelayMs: 1,
      })
    },
  },
  {
    name: 'SQLite',
    mount: root => async (ctx) => {
      await ctx.plugin(SqliteSessionPersistence, {
        path: join(root, 'sessions.sqlite'),
        journalMode: 'wal',
        writeBatchMaxDelayMs: 1,
      })
    },
  },
]

const liveHarnesses = new Set<BridgeHarness>()
const roots = new Set<string>()

afterEach(async () => {
  await Promise.allSettled([...liveHarnesses].map(harness => harness.dispose()))
  liveHarnesses.clear()
  await Promise.allSettled([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

async function harness(options: Parameters<typeof makeBridgeHarness>[0]): Promise<BridgeHarness> {
  const value = await makeBridgeHarness(options)
  liveHarnesses.add(value)
  return value
}

function messageText(harness: BridgeHarness, updateType: 'user_message_chunk' | 'agent_message_chunk'): string {
  return harness.updates.flatMap(update => (
    update.sessionUpdate === updateType && update.content.type === 'text'
      ? [update.content.text]
      : []
  )).join('')
}

describe.each(backends)('Standalone Runtime portability — $name', backend => {
  it('survives process-shaped teardown, lists, loads with replay, and continues reconstructed history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-portability-'))
    roots.add(root)
    const cwd = process.cwd()

    const first = await harness({
      script: [textResponse('first answer')],
      mount: backend.mount(root),
    })
    const initialized = await first.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    expect(initialized.agentCapabilities?.loadSession).toBe(true)
    expect(initialized.agentCapabilities?.sessionCapabilities?.list).toEqual({})
    expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
    expect(initialized.agentCapabilities?.sessionCapabilities?.close).toEqual({})

    const { sessionId } = await first.client.newSession({ cwd, mcpServers: [] })
    await expect(first.client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'first question' }],
    })).resolves.toEqual({ stopReason: 'end_turn' })

    await expect(first.client.closeSession({ sessionId })).resolves.toEqual({})
    await first.dispose()
    liveHarnesses.delete(first)

    const second = await harness({
      script: [textResponse('continued answer')],
      mount: backend.mount(root),
    })
    await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

    const listed = await second.client.listSessions({ cwd })
    expect(listed.sessions).toContainEqual({ sessionId, cwd })

    await expect(second.client.loadSession({ sessionId, cwd, mcpServers: [] })).resolves.toEqual({})
    expect(messageText(second, 'user_message_chunk')).toContain('first question')
    expect(messageText(second, 'agent_message_chunk')).toContain('first answer')

    await expect(second.client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'continue' }],
    })).resolves.toEqual({ stopReason: 'end_turn' })

    const request = second.adapter.requests.at(-1)
    expect(request).toBeDefined()
    const reconstructed = JSON.stringify(request)
    expect(reconstructed).toContain('first question')
    expect(reconstructed).toContain('first answer')
    expect(reconstructed).toContain('continue')
  })

  it('resume restores the same durable session without replaying historical transcript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-resume-'))
    roots.add(root)
    const cwd = process.cwd()

    const first = await harness({
      script: [textResponse('remember me')],
      mount: backend.mount(root),
    })
    await first.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await first.client.newSession({ cwd, mcpServers: [] })
    await first.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'persist me' }] })
    await first.client.closeSession({ sessionId })
    await first.dispose()
    liveHarnesses.delete(first)

    const second = await harness({ mount: backend.mount(root) })
    await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await expect(second.client.resumeSession({ sessionId, cwd, mcpServers: [] })).resolves.toEqual({})
    expect(second.updates).toEqual([])
  })
})
