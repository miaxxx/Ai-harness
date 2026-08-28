/** Persistent-session lifecycle helpers for the ACP boundary. */

import { Buffer } from 'node:buffer'
import { isAbsolute } from 'node:path'
import type { ListSessionsRequest, ListSessionsResponse } from '@agentclientprotocol/sdk'
import type { AgentHandle, AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

export const DEFAULT_SESSION_LIST_PAGE_SIZE = 100

interface Cursor {
  createdAt: number
  sessionId: string
}

/** Ensure a lifecycle request stays inside the currently supported workspace contract. */
export function validatePersistentWorkspace(
  cwd: string,
  additionalDirectories: readonly string[] | undefined,
  mcpServers: readonly unknown[] | undefined,
): void {
  if (!isAbsolute(cwd)) throw new Error(`cwd must be an absolute path: ${cwd}`)
  if (additionalDirectories !== undefined && additionalDirectories.length > 0) {
    throw new Error('additionalDirectories is not supported')
  }
  if (mcpServers !== undefined && mcpServers.length > 0) throw new Error('mcpServers is not supported')
}

/** Find one top-level persisted session and validate the workspace takeover. */
export async function resumableHeader(
  persistence: SessionPersistence,
  sessionId: SessionId,
  cwd: string,
): Promise<SessionHeader> {
  const header = (await persistence.list()).find(candidate => candidate.id === sessionId)
  if (header === undefined || header.origin === 'subagent' || header.parentSession !== undefined) {
    throw new Error(`session is not resumable: ${sessionId}`)
  }
  if (header.cwd !== cwd) throw new Error(`session cwd does not match: ${cwd}`)
  return header
}

/** Resume through the existing AgentRegistry; this is not a second Resume Engine. */
export async function activatePersistedSession(
  agents: AgentRegistry,
  persistence: SessionPersistence,
  options: {
    sessionId: SessionId
    cwd: string
    agentOptions: AgentOptions
  },
): Promise<AgentHandle> {
  await resumableHeader(persistence, options.sessionId, options.cwd)
  return agents.resume({
    resumeSessionId: options.sessionId,
    agentOptions: options.agentOptions,
  })
}

/** Boundary-only cursor pagination over the persistence seam's lightweight list. */
export async function listPersistedSessions(
  persistence: SessionPersistence,
  params: ListSessionsRequest,
  active: ReadonlySet<SessionId>,
  pageSize = DEFAULT_SESSION_LIST_PAGE_SIZE,
): Promise<ListSessionsResponse> {
  if (params.cwd !== undefined && params.cwd !== null && !isAbsolute(params.cwd)) {
    throw new Error(`cwd must be an absolute path: ${params.cwd}`)
  }
  const cursor = decodeCursor(params.cursor)
  const entries = (await persistence.list())
    .filter(header => (
      !active.has(header.id)
      && header.origin !== 'subagent'
      && header.parentSession === undefined
      && header.cwd !== undefined
      && isAbsolute(header.cwd)
      && (params.cwd === undefined || params.cwd === null || header.cwd === params.cwd)
    ))
    .map(header => ({ sessionId: header.id, cwd: header.cwd!, createdAt: header.createdAt }))
    .sort((left, right) => right.createdAt - left.createdAt || left.sessionId.localeCompare(right.sessionId))
    .filter(entry => cursor === undefined || afterCursor(entry, cursor))

  const page = entries.slice(0, pageSize)
  const next = entries.length > page.length ? page.at(-1) : undefined
  return {
    sessions: page.map(({ sessionId, cwd }) => ({ sessionId, cwd })),
    ...next === undefined ? {} : { nextCursor: encodeCursor(next) },
  }
}

function afterCursor(entry: Cursor, cursor: Cursor): boolean {
  return entry.createdAt < cursor.createdAt
    || (entry.createdAt === cursor.createdAt && entry.sessionId.localeCompare(cursor.sessionId) > 0)
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): Cursor | undefined {
  if (value === undefined || value === null) return
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
  } catch (error: unknown) {
    throw new Error('invalid session/list cursor', { cause: error })
  }
  if (
    parsed === null
    || typeof parsed !== 'object'
    || !Number.isSafeInteger((parsed as Cursor).createdAt)
    || typeof (parsed as Cursor).sessionId !== 'string'
  ) throw new Error('invalid session/list cursor')
  return parsed as Cursor
}
