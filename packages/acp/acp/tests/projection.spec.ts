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
