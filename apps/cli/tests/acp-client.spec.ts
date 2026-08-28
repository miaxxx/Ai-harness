import { describe, expect, it } from 'vitest'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import { renderAcpUpdate } from '../src/client/commands.ts'

describe('CLI ACP presentation boundary', () => {
  it('renders durable user and assistant text updates', () => {
    const user = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        messageId: 'message-user',
        content: { type: 'text', text: 'hello' },
      },
    } satisfies SessionNotification
    const assistant = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'message-assistant',
        content: { type: 'text', text: 'world' },
      },
    } satisfies SessionNotification

    expect(renderAcpUpdate(user)).toBe('user> hello\n')
    expect(renderAcpUpdate(assistant)).toBe('assistant> world\n')
  })

  it('does not stringify non-text content as fake transcript text', () => {
    const image = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'message-image',
        content: { type: 'image', data: 'AQ==', mimeType: 'image/png' },
      },
    } satisfies SessionNotification

    expect(renderAcpUpdate(image)).toBeUndefined()
  })
})
