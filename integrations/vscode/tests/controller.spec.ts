import { describe, expect, it } from 'vitest'
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AcpClientHandlers, AcpRuntimeSpec } from '@deepseek-ai/dsh-acp-client'
import {
  IdeAcpController,
  type IdeAcpClient,
  type IdeRuntimeConnector,
} from '../src/controller.ts'

interface FakeRuntime {
  connector: IdeRuntimeConnector
  handlers(): AcpClientHandlers
  calls: {
    listed: string[]
    loaded: string[]
    prompted: Array<{ sessionId: string, text: string }>
    closed: string[]
    disposed: number
    spec?: AcpRuntimeSpec
  }
}

function fakeRuntime(): FakeRuntime {
  let capturedHandlers: AcpClientHandlers | undefined
  const calls: FakeRuntime['calls'] = {
    listed: [],
    loaded: [],
    prompted: [],
    closed: [],
    disposed: 0,
  }

  const client = {
    async listSessions(request: { cwd?: string }) {
      const cwd = request.cwd ?? '/workspace'
      calls.listed.push(cwd)
      return { sessions: [{ sessionId: 'cli-session', cwd }] }
    },
    async loadSession(request: { sessionId: string, cwd: string }) {
      calls.loaded.push(request.sessionId)
      const updates: SessionNotification[] = [
        {
          sessionId: request.sessionId,
          update: {
            sessionUpdate: 'user_message_chunk',
            messageId: 'user-1',
            content: { type: 'text', text: 'created from CLI' },
          },
        },
        {
          sessionId: request.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'agent-1',
            content: { type: 'text', text: 'persisted answer' },
          },
        },
      ]
      for (const update of updates) await capturedHandlers?.onSessionUpdate(update)
      return {}
    },
    async newSession() {
      return { sessionId: 'ide-session' }
    },
    async prompt(request: { sessionId: string, prompt: Array<{ type: 'text', text: string }> }) {
      calls.prompted.push({ sessionId: request.sessionId, text: request.prompt[0]?.text ?? '' })
      return { stopReason: 'end_turn' as const }
    },
    async closeSession(request: { sessionId: string }) {
      calls.closed.push(request.sessionId)
      return {}
    },
  } as unknown as IdeAcpClient

  const connector: IdeRuntimeConnector = async (spec, handlers) => {
    calls.spec = spec
    capturedHandlers = handlers
    return {
      client,
      async dispose() {
        calls.disposed += 1
      },
    }
  }

  return {
    connector,
    calls,
    handlers() {
      if (capturedHandlers === undefined) throw new Error('Runtime was not connected')
      return capturedHandlers
    },
  }
}

describe('VS Code ACP controller', () => {
  it('lists and loads a CLI-created durable Session, receives replay, and continues it', async () => {
    const runtime = fakeRuntime()
    const updates: SessionNotification[] = []
    const controller = new IdeAcpController({
      onSessionUpdate(notification) {
        updates.push(notification)
      },
    }, runtime.connector)

    await controller.start({ command: 'runtime', args: ['--stdio'], cwd: '/workspace' })
    const listed = await controller.listSessions('/workspace')
    expect(listed.sessions.map(session => session.sessionId)).toEqual(['cli-session'])

    await controller.loadSession('cli-session', '/workspace')
    expect(controller.activeSessionId).toBe('cli-session')
    expect(updates.map(notification => notification.update.sessionUpdate)).toEqual([
      'user_message_chunk',
      'agent_message_chunk',
    ])

    const result = await controller.prompt('  continue from IDE  ')
    expect(result.stopReason).toBe('end_turn')
    expect(runtime.calls.prompted).toEqual([
      { sessionId: 'cli-session', text: 'continue from IDE' },
    ])

    await controller.dispose()
    expect(runtime.calls.closed).toEqual(['cli-session'])
    expect(runtime.calls.disposed).toBe(1)
    expect(runtime.calls.spec).toEqual({ command: 'runtime', args: ['--stdio'], cwd: '/workspace' })
  })

  it('closes the current live Session before sequentially taking ownership of another one', async () => {
    const runtime = fakeRuntime()
    const controller = new IdeAcpController({ onSessionUpdate() {} }, runtime.connector)
    await controller.start({ command: 'runtime', args: [], cwd: '/workspace' })

    expect(await controller.newSession('/workspace')).toBe('ide-session')
    await controller.loadSession('cli-session', '/workspace')

    expect(runtime.calls.closed).toEqual(['ide-session'])
    expect(runtime.calls.loaded).toEqual(['cli-session'])
    expect(controller.activeSessionId).toBe('cli-session')
  })

  it('routes Runtime approval through the IDE ACP permission callback', async () => {
    const runtime = fakeRuntime()
    const permissionRequests: RequestPermissionRequest[] = []
    const selected: RequestPermissionResponse = {
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    }
    const controller = new IdeAcpController({
      onSessionUpdate() {},
      requestPermission(request) {
        permissionRequests.push(request)
        return Promise.resolve(selected)
      },
    }, runtime.connector)
    await controller.start({ command: 'runtime', args: [], cwd: '/workspace' })

    const request: RequestPermissionRequest = {
      sessionId: 'cli-session',
      toolCall: { toolCallId: 'call-1' },
      options: [
        { optionId: 'allow-once', kind: 'allow_once' },
        { optionId: 'reject-once', kind: 'reject_once' },
      ],
    }
    await expect(runtime.handlers().onPermissionRequest?.(request)).resolves.toEqual(selected)
    expect(permissionRequests).toEqual([request])
  })

  it('rejects prompts without an active Session instead of inventing Runtime state', async () => {
    const runtime = fakeRuntime()
    const controller = new IdeAcpController({ onSessionUpdate() {} }, runtime.connector)
    await controller.start({ command: 'runtime', args: [], cwd: '/workspace' })
    await expect(controller.prompt('hello')).rejects.toThrow('no active ACP Session')
  })
})
