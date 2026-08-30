import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { eventToAcpProjections, parseToolArguments } from '../src/projection.ts'

function event(value: unknown): SessionEvent {
  return value as SessionEvent
}

describe('ACP durable event projection', () => {
  it('projects committed append-origin assistant messages', () => {
    expect(eventToAcpProjections(event({
      type: 'assistant/message',
      seq: 2,
      time: 0,
      surfaceOp: 'append',
      data: {
        turn: 0,
        step: 0,
        message: { id: 'assistant-1', role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      },
    }))).toEqual([{
      kind: 'message',
      role: 'agent',
      messageId: 'assistant-1',
      blocks: [{ type: 'text', text: 'hello' }],
    }])
  })

  it('keeps model-only surface replacements off the client transcript', () => {
    expect(eventToAcpProjections(event({
      type: 'assistant/message',
      seq: 5,
      time: 0,
      surfaceOp: { op: 'replace', start: 1, end: 3 },
      sourceEventSeqs: [1, 2, 3],
      data: {
        turn: 1,
        step: 0,
        message: { id: 'summary', role: 'assistant', content: [{ type: 'text', text: 'compacted' }] },
      },
    }))).toEqual([])
  })

  it('keeps plugin-authored model context off the client transcript', () => {
    expect(eventToAcpProjections(event({
      type: 'user/message',
      seq: 6,
      time: 0,
      surfaceOp: 'append',
      data: {
        id: 'runtime-context',
        role: 'user',
        content: [{ type: 'text', text: '<system-reminder>internal</system-reminder>' }],
        source: { kind: 'plugin', plugin: 'system-prompt' },
      },
    }))).toEqual([])
  })

  it('projects human-authored user messages', () => {
    expect(eventToAcpProjections(event({
      type: 'user/message',
      seq: 7,
      time: 0,
      surfaceOp: 'append',
      data: {
        id: 'prompt',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      },
    }))).toEqual([{
      kind: 'message',
      role: 'user',
      messageId: 'prompt',
      blocks: [{ type: 'text', text: 'hello' }],
    }])
  })

  it('projects text and reasoning deltas for live clients', () => {
    expect(eventToAcpProjections(event({
      type: 'assistant/chunk', seq: 2, time: 0,
      data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'hello' } },
    }))).toEqual([{
      kind: 'agent-stream', channel: 'message', messageId: 'dsh-stream-1-2', text: 'hello',
    }])
    expect(eventToAcpProjections(event({
      type: 'assistant/chunk', seq: 3, time: 0,
      data: { turn: 1, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: 'plan' } },
    }))).toEqual([{
      kind: 'agent-stream', channel: 'thought', messageId: 'dsh-stream-1-2', text: 'plan',
    }])
  })

  it('projects tool lifecycle and whole-list plan state', () => {
    expect(eventToAcpProjections(event({
      type: 'tool/call',
      seq: 3,
      time: 0,
      data: { turn: 0, step: 0, callId: 'call-1', name: 'read_file', arguments: '{"path":"a"}' },
    }))).toEqual([{
      kind: 'tool-call',
      toolCallId: 'call-1',
      title: 'read_file',
      rawArguments: '{"path":"a"}',
    }])

    expect(eventToAcpProjections(event({
      type: 'todo/write',
      seq: 4,
      time: 0,
      data: { todos: [{ content: 'Inspect repository', status: 'in_progress' }] },
    }))).toEqual([{
      kind: 'plan',
      entries: [{ content: 'Inspect repository', status: 'in_progress' }],
    }])
  })

  it('ignores runtime-only boundaries and preserves malformed tool input', () => {
    expect(eventToAcpProjections(event({ type: 'turn/start', seq: 0, time: 0, data: { turn: 0 } }))).toEqual([])
    expect(parseToolArguments('{"ok":true}')).toEqual({ ok: true })
    expect(parseToolArguments('{broken')).toBe('{broken')
  })
})
