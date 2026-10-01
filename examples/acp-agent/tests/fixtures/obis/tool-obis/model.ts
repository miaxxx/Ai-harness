/** Scripted provider exercises the real ACP, tool registry and HTTP event consumer. */
import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class EventReader extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (result?.type !== 'tool-result') {
      const args = JSON.stringify({ afterId: 'event-1' })
      const id = CallId('call-event')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'obis_next_run_event', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'obis_next_run_event', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (!text.includes('query.completed') || text.includes('private-lease') || text.includes('private-token')) throw new Error('Expected a public event without credentials.')
    const reply = 'Kernel SSE: query.completed (event-2)'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'mock-obis-model'
export const inject = ['llm']

/**
 * Mount a scripted model for the event-read transcript.
 * @param ctx Provider registry used by the runnable ACP composition.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.llm.registerAdapter(['mock-obis'], new EventReader()), 'event reader adapter')
}
