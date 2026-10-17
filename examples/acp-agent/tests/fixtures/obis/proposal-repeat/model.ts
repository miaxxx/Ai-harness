/** Scripted proposal provider for consecutive writes through the runnable ACP application. */
import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class ProposalWriter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (result?.type !== 'tool-result') {
      const second = options.messages.some(message => message.content.some(block =>
        block.type === 'text' && block.text.includes('Second write')))
      const id = CallId(second ? 'write-second' : 'write-first')
      const args = JSON.stringify({ action: 'Asset.create', input: { name: String(id) } })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'obis_propose_action', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'obis_propose_action', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (!text.includes('executed')) throw new Error('Expected a confirmed execution result.')
    const reply = 'OBIS confirmed write completed.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'mock-obis-proposal-model'
export const inject = ['llm']

/**
 * Mount the deterministic proposal provider.
 * @param ctx Model provider registry of the ACP application.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.llm.registerAdapter(['mock-obis-proposal'], new ProposalWriter()), 'proposal writer adapter')
}
