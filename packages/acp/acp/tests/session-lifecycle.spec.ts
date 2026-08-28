import { describe, expect, it, vi } from 'vitest'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import {
  activatePersistedSession,
  listPersistedSessions,
  resumableHeader,
  validatePersistentWorkspace,
} from '../src/session-lifecycle.ts'

function header(id: string, cwd: string, createdAt: number): SessionHeader {
  return { version: 0, id: SessionId(id), cwd, createdAt }
}

function persistence(headers: SessionHeader[]): SessionPersistence {
  return { list: vi.fn().mockResolvedValue(headers) } as unknown as SessionPersistence
}

describe('ACP persisted session lifecycle', () => {
  it('validates the current workspace feature boundary', () => {
    expect(() => validatePersistentWorkspace('/tmp/work', [], [])).not.toThrow()
    expect(() => validatePersistentWorkspace('relative', [], [])).toThrow(/absolute/)
    expect(() => validatePersistentWorkspace('/tmp/work', ['/tmp/extra'], [])).toThrow(/additionalDirectories/)
    expect(() => validatePersistentWorkspace('/tmp/work', [], [{}])).toThrow(/mcpServers/)
  })

  it('lists top-level inactive sessions with opaque cursor pagination', async () => {
    const store = persistence([
      header('a', '/tmp/work', 30),
      header('b', '/tmp/work', 20),
      header('c', '/tmp/other', 10),
      { ...header('child', '/tmp/work', 40), origin: 'subagent' },
    ])
    const first = await listPersistedSessions(store, { cwd: '/tmp/work' }, new Set(), 1)
    expect(first.sessions).toEqual([{ sessionId: 'a', cwd: '/tmp/work' }])
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await listPersistedSessions(store, { cwd: '/tmp/work', cursor: first.nextCursor }, new Set(), 1)
    expect(second).toEqual({ sessions: [{ sessionId: 'b', cwd: '/tmp/work' }] })
  })

  it('rejects non-resumable or mismatched persisted sessions', async () => {
    const store = persistence([header('a', '/tmp/work', 1)])
    await expect(resumableHeader(store, SessionId('missing'), '/tmp/work')).rejects.toThrow(/not resumable/)
    await expect(resumableHeader(store, SessionId('a'), '/tmp/other')).rejects.toThrow(/cwd does not match/)
  })

  it('delegates activation to the existing AgentRegistry resume seam', async () => {
    const store = persistence([header('a', '/tmp/work', 1)])
    const handle = { agent: { id: SessionId('a') }, dispose: vi.fn() }
    const resume = vi.fn().mockResolvedValue(handle)
    const agents = { resume } as unknown as AgentRegistry

    await expect(activatePersistedSession(agents, store, {
      sessionId: SessionId('a'),
      cwd: '/tmp/work',
      agentOptions: { provider: 'p', model: 'm' },
    })).resolves.toBe(handle)
    expect(resume).toHaveBeenCalledWith({
      resumeSessionId: SessionId('a'),
      agentOptions: { provider: 'p', model: 'm' },
    })
  })
})
