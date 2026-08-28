/**
 * Persistent Agent Client Protocol boundary over JSON-RPC stdio.
 *
 * ACP owns live Agent handles and protocol work. Durable conversation identity
 * belongs to Session persistence and survives client/connection teardown.
 *
 * @module @deepseek-ai/dsh-acp
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Readable, Writable } from 'node:stream'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent as AcpAgent,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionNotification,
  type StopReason,
  type Stream,
} from '@agentclientprotocol/sdk'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
// Side-effect type import: declaration-merges the approval waterfall answered below.
import type {} from '@deepseek-ai/dsh-user-approval'
import { AcpContentError, admitAcpPrompt, supportsAcpImagePrompts } from './content.ts'
import { turnEndToStopReason } from './codec.ts'
import { eventToAcpProjections } from './projection.ts'
import {
  activatePersistedSession,
  DEFAULT_SESSION_LIST_PAGE_SIZE,
  listPersistedSessions,
  type SessionPersistenceCapability,
  validatePersistentWorkspace,
} from './session-lifecycle.ts'
import { projectionToAcpUpdates } from './updates.ts'

export const name = 'acp'
/** Fresh sessions work without persistence; durable lifecycle capabilities are discovered at runtime. */
export const inject = ['agents']

interface ContinuableDrain {
  drainContinuableDescendants(parents: readonly Agent[]): Promise<void>
}

function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

export interface AcpConfig {
  provider?: string
  model?: string
  sessionListPageSize?: number
  stream?: Stream
}

export const Config: Schema<AcpConfig> = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  sessionListPageSize: Schema.natural().min(1).default(DEFAULT_SESSION_LIST_PAGE_SIZE),
})

/** Per-connection live state only. Durable Session identity is not owned here. */
interface SessionRecord {
  agent: Agent
  dispose: () => Promise<void>
  outputTail: Promise<void>
  inflight: {
    resolve: (reason: StopReason) => void
    reject: (error: Error) => void
    messageId: string | undefined
    messageQueued: boolean
    turn: number | undefined
    endReason: TurnEndReason | undefined
    admissionDone: Promise<void>
    finishAdmission: () => void
    admissionController: AbortController
    cancelRequested: boolean
    settlementStarted: boolean
    outputError: Error | undefined
    agentError: Error | undefined
  } | undefined
}

export function apply(ctx: Context, config: AcpConfig): void {
  const agents = ctx.agents
  const logger = ctx.logger
  const sessions = new Map<SessionId, SessionRecord>()
  const activating = new Set<SessionId>()
  const pageSize = config.sessionListPageSize ?? DEFAULT_SESSION_LIST_PAGE_SIZE
  let closed = false
  let conn: AgentSideConnection
  let imagePromptEnabled = false

  const persistence = (): SessionPersistenceCapability | undefined => (
    ctx.get('sessionPersistence') as SessionPersistenceCapability | undefined
  )

  const ownedRecord = (agent: Agent): SessionRecord | undefined => {
    const record = sessions.get(agent.session.id)
    return record?.agent === agent ? record : undefined
  }

  const assertOpen = (): void => {
    if (closed) throw internalError('the ACP bridge has been disposed')
  }

  const requireSession = (sessionId: SessionId): SessionRecord => {
    const record = sessions.get(sessionId)
    if (record === undefined) throw invalidParams(`unknown session: ${sessionId}`)
    return record
  }

  const requirePersistence = (): SessionPersistenceCapability => {
    const service = persistence()
    if (service === undefined) {
      throw internalError('session persistence is not configured')
    }
    return service
  }

  const notify = async (notification: SessionNotification): Promise<void> => {
    try {
      await conn.sessionUpdate(notification)
    /* v8 ignore start -- only transport write failure reaches this guard. */
    } catch (error: unknown) {
      logger.warn(`acp: session/update failed: ${String(error)}`)
    }
    /* v8 ignore stop */
  }

  /** Live and replay delivery share exactly this materialization path. */
  const deliverEvent = async (sessionId: SessionId, event: SessionEvent): Promise<void> => {
    for (const projection of eventToAcpProjections(event)) {
      for (const update of await projectionToAcpUpdates(ctx, projection)) {
        await notify({ sessionId, update })
      }
    }
  }

  const rejectFromError = (
    inflight: NonNullable<SessionRecord['inflight']>,
    reason: Extract<TurnEndReason, { kind: 'error' }>,
  ): void => {
    inflight.reject(internalError(`turn failed: ${reason.error.message}`))
  }

  const settleAfterQuiescence = (
    record: SessionRecord,
    inflight: NonNullable<SessionRecord['inflight']>,
  ): void => {
    if (inflight.settlementStarted) return
    inflight.settlementStarted = true
    void (async () => {
      await inflight.admissionDone
      if (inflight.messageQueued) {
        await record.agent.whenIdle()
        await record.outputTail
      }
      /* v8 ignore next -- this prompt owns the slot until this exact settlement clears it. */
      if (record.inflight !== inflight) return
      record.inflight = undefined
      if (inflight.cancelRequested) {
        inflight.resolve('cancelled')
        return
      }
      if (inflight.outputError !== undefined) {
        inflight.reject(internalError(`assistant output delivery failed: ${inflight.outputError.message}`))
        return
      }
      if (inflight.agentError !== undefined) {
        inflight.reject(internalError(`turn failed: ${inflight.agentError.message}`))
        return
      }
      const end = inflight.endReason
      if (end === undefined) {
        inflight.resolve('cancelled')
      } else if (end.kind === 'error') {
        rejectFromError(inflight, end)
      } else {
        inflight.resolve(end.kind === 'max-tokens' ? 'end_turn' : turnEndToStopReason(end))
      }
    })()
    /* v8 ignore start -- admissionDone only resolves; idle/output gates contain their own failures. */
      .catch((error: unknown) => {
        if (record.inflight !== inflight) return
        record.inflight = undefined
        inflight.reject(internalError(`prompt settlement failed: ${errorChain(error)}`))
      })
    /* v8 ignore stop */
  }

  /** Queue one committed event after all earlier output for this live session. */
  const enqueueLiveEvent = (record: SessionRecord, event: SessionEvent): void => {
    const inflight = (
      (event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result')
      && record.inflight?.turn === event.data.turn
    ) ? record.inflight : undefined
    const delivery = record.outputTail.then(() => deliverEvent(record.agent.session.id, event))
    record.outputTail = delivery.catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (inflight !== undefined) inflight.outputError ??= failure
      logger.warn(`acp: session projection delivery failed: ${errorChain(error)}`)
    })
  }

  ctx.on('session/event', (session, event: SessionEvent) => {
    const record = sessions.get(session.header.id)
    if (record === undefined || record.agent.session !== session) return
    try {
      enqueueLiveEvent(record, event)
    } finally {
      const inflight = record.inflight
      if (inflight !== undefined && event.type === 'turn/end' && inflight.turn === event.data.turn) {
        inflight.endReason = event.data.reason
      }
    }
  })

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const record = ownedRecord(agent)
    const inflight = record?.inflight
    if (inflight !== undefined && inflight.messageId === message.id) inflight.turn = turn
  })

  ctx.on('agent/error', ({ agent, turn, error }) => {
    const record = ownedRecord(agent)
    const inflight = record?.inflight
    if (record === undefined || inflight === undefined || !inflight.messageQueued || inflight.turn === turn) return
    inflight.agentError = new Error(errorChain(error))
    settleAfterQuiescence(record, inflight)
  })

  ctx.on('approval/request', (request, next) => {
    const record = ownedRecord(request.agent)
    if (record === undefined || request.callId === undefined) return next()
    return conn.requestPermission({
      sessionId: record.agent.session.id,
      toolCall: { toolCallId: request.callId },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    }).then(({ outcome }) => {
      if (outcome.outcome === 'cancelled') return 'cancelled'
      return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
    })
  })

  const recordFromHandle = (handle: AgentHandle): SessionRecord => ({
    agent: handle.agent,
    dispose: () => handle.dispose(),
    outputTail: Promise.resolve(),
    inflight: undefined,
  })

  /** Shared activation primitive used by load and resume; only replay differs. */
  const activateSession = async (
    params: LoadSessionRequest | ResumeSessionRequest,
    replay: boolean,
  ): Promise<SessionRecord> => {
    assertOpen()
    try {
      validatePersistentWorkspace(params.cwd, params.additionalDirectories, params.mcpServers)
    } catch (error: unknown) {
      throw invalidParams((error as Error).message)
    }
    const sessionId = SessionId(params.sessionId)
    if (sessions.has(sessionId) || activating.has(sessionId) || agents.get(sessionId) !== undefined) {
      throw invalidParams(`session is already active: ${sessionId}`)
    }
    activating.add(sessionId)
    try {
      let handle: AgentHandle
      try {
        handle = await activatePersistedSession(agents, requirePersistence(), {
          sessionId,
          cwd: params.cwd,
          agentOptions: agentOptions(config),
        })
      } catch (error: unknown) {
        if (error instanceof RequestError) throw error
        throw invalidParams((error as Error).message)
      }
      if (closed) {
        await handle.dispose()
        throw internalError('connection closed during persisted session activation')
      }
      const record = recordFromHandle(handle)
      sessions.set(sessionId, record)
      try {
        if (replay) {
          // ACP load requires history to be delivered before the response.
          for (const event of record.agent.session.events) await deliverEvent(sessionId, event)
        }
        assertOpen()
        return record
      } catch (error: unknown) {
        sessions.delete(sessionId)
        await handle.dispose()
        throw error
      }
    } finally {
      activating.delete(sessionId)
    }
  }

  const closeRecord = async (record: SessionRecord, reason: string): Promise<void> => {
    const inflight = record.inflight
    if (inflight !== undefined) {
      inflight.cancelRequested = true
      inflight.admissionController.abort(new Error(reason))
      settleAfterQuiescence(record, inflight)
    }
    record.agent.cancel({ kind: 'user' })
    await inflight?.admissionDone
    await record.agent.whenIdle()
    await record.outputTail
    const subagents = ctx.get('subagents') as ContinuableDrain | undefined
    if (subagents !== undefined) await subagents.drainContinuableDescendants([record.agent])
    await record.dispose()
  }

  const makeAgent = (connection: AgentSideConnection): AcpAgent => {
    conn = connection
    return {
      async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
        imagePromptEnabled = await supportsAcpImagePrompts(ctx, config.provider, config.model)
        const durable = persistence() !== undefined
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
          agentCapabilities: {
            promptCapabilities: { image: imagePromptEnabled, audio: false, embeddedContext: false },
            sessionCapabilities: durable
              ? { close: {}, list: {}, resume: {} }
              : { close: {} },
            ...(durable ? { loadSession: true } : {}),
          },
          authMethods: [],
        }
      },

      authenticate(_params: AuthenticateRequest): Promise<void> {
        return Promise.resolve()
      },

      async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
        assertOpen()
        validateSessionParams(params)
        const sessionId = SessionId(randomUUID())
        const handle = await agents.create({
          sessionId,
          meta: { cwd: params.cwd },
          agentOptions: agentOptions(config),
        })
        /* v8 ignore next 4 -- a real stdio close can race an in-flight create. */
        if (closed) {
          await handle.dispose()
          throw internalError('connection closed during session/new')
        }
        sessions.set(sessionId, recordFromHandle(handle))
        return { sessionId }
      },

      async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
        assertOpen()
        const active = new Set<SessionId>([...sessions.keys(), ...activating])
        try {
          return await listPersistedSessions(requirePersistence(), params, active, pageSize)
        } catch (error: unknown) {
          if (error instanceof RequestError) throw error
          throw invalidParams((error as Error).message)
        }
      },

      async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
        await activateSession(params, true)
        return {}
      },

      async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
        await activateSession(params, false)
        return {}
      },

      async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
        assertOpen()
        const sessionId = SessionId(params.sessionId)
        const record = requireSession(sessionId)
        sessions.delete(sessionId)
        try {
          await closeRecord(record, 'ACP session closed')
        } catch (error: unknown) {
          throw internalError(`session close failed: ${errorChain(error)}`)
        }
        return {}
      },

      async prompt(params: PromptRequest): Promise<PromptResponse> {
        assertOpen()
        const record = requireSession(SessionId(params.sessionId))
        if (record.inflight !== undefined) {
          throw invalidParams('a prompt is already in flight for this session')
        }
        const completion = Promise.withResolvers<StopReason>()
        const admission = Promise.withResolvers<void>()
        const admissionController = new AbortController()
        const inflight: NonNullable<SessionRecord['inflight']> = {
          resolve: completion.resolve,
          reject: completion.reject,
          messageId: undefined,
          messageQueued: false,
          turn: undefined,
          endReason: undefined,
          admissionDone: admission.promise,
          finishAdmission: admission.resolve,
          admissionController,
          cancelRequested: false,
          settlementStarted: false,
          outputError: undefined,
          agentError: undefined,
        }
        record.inflight = inflight

        let admissionFailed = false
        let admissionFailure: unknown
        try {
          if (ctx.agents.get(record.agent.id) !== record.agent) {
            throw internalError('prompt was not queued: the agent was disposed outside the bridge')
          }
          const content = await admitAcpPrompt(
            ctx,
            record.agent,
            params.prompt,
            imagePromptEnabled,
            admissionController.signal,
          )
          admissionController.signal.throwIfAborted()
          if (ctx.agents.get(record.agent.id) !== record.agent) {
            throw internalError('prompt was not queued: the agent was disposed outside the bridge')
          }
          const message = createUserMessage({ content, source: { kind: 'user' } })
          inflight.messageId = message.id
          inflight.messageQueued = true
          try {
            record.agent.followup(message)
          } catch (error: unknown) {
            inflight.messageQueued = false
            throw error
          }
        } catch (error: unknown) {
          admissionFailed = true
          admissionFailure = error
        } finally {
          inflight.finishAdmission()
        }

        if (inflight.cancelRequested) {
          settleAfterQuiescence(record, inflight)
          return { stopReason: await completion.promise }
        }
        if (admissionFailed) {
          record.inflight = undefined
          if (admissionFailure instanceof AcpContentError) {
            throw admissionFailure.kind === 'invalid'
              ? invalidParams(admissionFailure.message)
              : internalError(admissionFailure.message)
          }
          if (admissionFailure instanceof RequestError) throw admissionFailure
          throw internalError(`prompt was not queued: ${(admissionFailure as Error).message}`)
        }

        settleAfterQuiescence(record, inflight)
        return { stopReason: await completion.promise }
      },

      cancel(params: CancelNotification): Promise<void> {
        const record = sessions.get(SessionId(params.sessionId))
        if (record === undefined) return Promise.resolve()
        const inflight = record.inflight
        if (inflight !== undefined) {
          inflight.cancelRequested = true
          inflight.admissionController.abort(new Error('ACP prompt cancelled'))
          settleAfterQuiescence(record, inflight)
        }
        if (inflight === undefined || inflight.messageQueued) record.agent.cancel({ kind: 'user' })
        return Promise.resolve()
      },
    }
  }

  /* v8 ignore next 4 -- production stdio wiring; tests inject config.stream. */
  const stream: Stream = config.stream ?? ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  )
  conn = new AgentSideConnection(makeAgent, stream)

  let quiescing: Promise<void> | undefined
  const quiesce = (): Promise<void> => {
    if (quiescing !== undefined) return quiescing
    closed = true
    const records = [...sessions.values()]
    sessions.clear()
    for (const record of records) {
      const inflight = record.inflight
      if (inflight !== undefined) {
        inflight.cancelRequested = true
        inflight.admissionController.abort(new Error('ACP bridge disposed'))
        settleAfterQuiescence(record, inflight)
      }
      record.agent.cancel({ kind: 'user' })
    }
    quiescing = (async () => {
      await Promise.all(records.map(async (record) => {
        await record.inflight?.admissionDone
        await record.agent.whenIdle()
        await record.outputTail
      }))
      const subagents = ctx.get('subagents') as ContinuableDrain | undefined
      if (subagents !== undefined) {
        try {
          await subagents.drainContinuableDescendants(records.map(record => record.agent))
        } catch (error: unknown) {
          logger.warn(`acp: continuable subagent teardown failed: ${String(error)}`)
        }
      }
      const disposals = await Promise.allSettled(records.map(record => record.dispose()))
      const failures: unknown[] = []
      for (const result of disposals) if (result.status === 'rejected') failures.push(result.reason as unknown)
      if (failures.length > 0) {
        const detail = failures.map(failure => errorChain(failure)).join('; ')
        throw new AggregateError(
          failures,
          `ACP agent teardown failed for ${failures.length} session(s): ${detail}`,
        )
      }
    })()
    return quiescing
  }

  /* v8 ignore start -- production transport rejection and teardown failure. */
  void conn.closed
    .catch((error: unknown) => {
      logger.warn(`acp: connection closed with an error: ${String(error)}`)
    })
    .then(quiesce)
    .catch((error: unknown) => {
      logger.warn(`acp: connection-close teardown failed: ${String(error)}`)
    })
  /* v8 ignore stop */

  ctx.effect(() => quiesce, 'acp.connection')
}

function agentOptions(config: AcpConfig): { provider?: string; model?: string } {
  return {
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
  }
}

function validateSessionParams(params: NewSessionRequest): void {
  if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
  if (params.additionalDirectories !== undefined && params.additionalDirectories.length > 0) {
    throw invalidParams('additionalDirectories is not supported')
  }
  if (params.mcpServers.length > 0) throw invalidParams('mcpServers is not supported')
}
