import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestPermissionRequest, SessionNotification } from '@agentclientprotocol/sdk'
import type { AcpClientHandlers, AcpRuntimeConnection } from '@deepseek-ai/dsh-acp-client'
import { VscodeAcpClient } from '../src/acp-client.ts'

const mock = vi.hoisted(() => ({ connect: vi.fn() }))

vi.mock('@deepseek-ai/dsh-acp-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-acp-client')>()
  return { ...original, connectAcpRuntime: mock.connect }
})

function makeRuntime(): {
  runtime: AcpRuntimeConnection
  listSessions: ReturnType<typeof vi.fn>
  newSession: ReturnType<typeof vi.fn>
  loadSession: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  closeSession: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
} {
  const listSessions = vi.fn().mockResolvedValue({ sessions: [] })
  const newSession = vi.fn().mockResolvedValue({ sessionId: 'session-new' })
  const loadSession = vi.fn().mockResolvedValue({})
  const prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' })
  const closeSession = vi.fn().mockResolvedValue({})
  const dispose = vi.fn().mockResolvedValue(undefined)
  const runtime = {
    client: { listSessions, newSession, loadSession, prompt, closeSession },
    dispose,
  } as unknown as AcpRuntimeConnection
  return { runtime, listSessions, newSession, loadSession, prompt, closeSession, dispose }
}

describe('VS Code ACP client ownership', () => {
  beforeEach(() => {
    mock.connect.mockReset()
  })

  it('lazily creates one Runtime connection and drives a fresh Session only through ACP', async () => {
    const fixture = makeRuntime()
    mock.connect.mockResolvedValue(fixture.runtime)
    const client = new VscodeAcpClient(
      { command: 'runtime', args: ['--stdio'], cwd: '/workspace' },
      { onSessionUpdate() {} },
    )

    await expect(client.createSession('/workspace')).resolves.toBe('session-new')
    await expect(client.prompt('hello')).resolves.toEqual({ stopReason: 'end_turn' })
    await client.closeActiveSession()

    expect(mock.connect).toHaveBeenCalledTimes(1)
    expect(fixture.newSession).toHaveBeenCalledWith({ cwd: '/workspace', mcpServers: [] })
    expect(fixture.prompt).toHaveBeenCalledWith({
      sessionId: 'session-new',
      prompt: [{ type: 'text', text: 'hello' }],
    })
    expect(fixture.closeSession).toHaveBeenCalledWith({ sessionId: 'session-new' })
    expect(client.activeSessionId).toBeUndefined()
  })

  it('releases the previous live Session before loading another durable Session', async () => {
    const fixture = makeRuntime()
    mock.connect.mockResolvedValue(fixture.runtime)
    const client = new VscodeAcpClient(
      { command: 'runtime', args: [], cwd: '/workspace' },
      { onSessionUpdate() {} },
    )

    await client.createSession('/workspace')
    await client.loadSession('persisted-session', '/workspace')

    expect(fixture.closeSession.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.loadSession.mock.invocationCallOrder[0]!,
    )
    expect(fixture.loadSession).toHaveBeenCalledWith({
      sessionId: 'persisted-session',
      cwd: '/workspace',
      mcpServers: [],
    })
    expect(client.activeSessionId).toBe('persisted-session')
  })

  it('delivers load replay through the same ACP update handler and continues the CLI-created Session', async () => {
    const fixture = makeRuntime()
    let handlers: AcpClientHandlers | undefined
    mock.connect.mockImplementation(async (_spec, nextHandlers: AcpClientHandlers) => {
      handlers = nextHandlers
      return fixture.runtime
    })
    const updates: SessionNotification[] = []
    const client = new VscodeAcpClient(
      { command: 'runtime', args: [], cwd: '/workspace' },
      { onSessionUpdate: (notification) => { updates.push(notification) } },
    )
    fixture.loadSession.mockImplementation((request: { sessionId: string }) => {
      const replay: SessionNotification[] = [
        {
          sessionId: request.sessionId,
          update: {
            sessionUpdate: 'user_message_chunk',
            messageId: 'cli-user',
            content: { type: 'text', text: 'created from CLI' },
          },
        },
        {
          sessionId: request.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'cli-agent',
            content: { type: 'text', text: 'persisted answer' },
          },
        },
      ]
      for (const notification of replay) void handlers?.onSessionUpdate(notification)
      return {}
    })

    await client.loadSession('cli-session', '/workspace')
    await client.prompt('continue from IDE')

    expect(updates.map(notification => notification.update.sessionUpdate)).toEqual([
      'user_message_chunk',
      'agent_message_chunk',
    ])
    expect(fixture.prompt).toHaveBeenCalledWith({
      sessionId: 'cli-session',
      prompt: [{ type: 'text', text: 'continue from IDE' }],
    })
  })

  it('passes the Runtime permission request to the IDE-owned ACP approval handler', async () => {
    const fixture = makeRuntime()
    let handlers: AcpClientHandlers | undefined
    mock.connect.mockImplementation(async (_spec, nextHandlers: AcpClientHandlers) => {
      handlers = nextHandlers
      return fixture.runtime
    })
    const seen: RequestPermissionRequest[] = []
    const client = new VscodeAcpClient(
      { command: 'runtime', args: [], cwd: '/workspace' },
      {
        onSessionUpdate() {},
        onPermissionRequest(request) {
          seen.push(request)
          return Promise.resolve({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
        },
      },
    )
    await client.listSessions('/workspace')

    const request: RequestPermissionRequest = {
      sessionId: 'cli-session',
      toolCall: { toolCallId: 'call-1' },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
      ],
    }
    await expect(handlers?.onPermissionRequest?.(request)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })
    expect(seen).toEqual([request])
  })

  it('lists durable Sessions without inventing a client-side Session store', async () => {
    const fixture = makeRuntime()
    fixture.listSessions.mockResolvedValue({
      sessions: [{ sessionId: 'persisted', cwd: '/workspace', title: 'Existing' }],
    })
    mock.connect.mockResolvedValue(fixture.runtime)
    const client = new VscodeAcpClient(
      { command: 'runtime', args: [], cwd: '/workspace' },
      { onSessionUpdate() {} },
    )

    await expect(client.listSessions('/workspace')).resolves.toEqual({
      sessions: [{ sessionId: 'persisted', cwd: '/workspace', title: 'Existing' }],
    })
    expect(client.activeSessionId).toBeUndefined()
  })

  it('closes the live Session before disposing the owned Runtime process', async () => {
    const fixture = makeRuntime()
    mock.connect.mockResolvedValue(fixture.runtime)
    const client = new VscodeAcpClient(
      { command: 'runtime', args: [], cwd: '/workspace' },
      { onSessionUpdate() {} },
    )
    await client.createSession('/workspace')

    await client.dispose()
    await client.dispose()

    expect(fixture.closeSession).toHaveBeenCalledTimes(1)
    expect(fixture.dispose).toHaveBeenCalledTimes(1)
    expect(fixture.closeSession.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.dispose.mock.invocationCallOrder[0]!,
    )
    await expect(client.prompt('after-dispose')).rejects.toThrow('No active DeepSeek Harness Session')
  })
})
