/** Pure SessionEvent -> ACP semantic projection boundary. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Protocol-semantic facts produced without Context, IO, or transport state. */
export type AcpProjection =
  | {
    kind: 'message'
    role: 'user' | 'agent'
    messageId: string
    blocks: readonly ContentBlock[]
  }
  | {
    kind: 'tool-call'
    toolCallId: string
    title: string
    rawArguments: string
  }
  | {
    kind: 'tool-result'
    toolCallId: string
    isError: boolean
    blocks: readonly ContentBlock[]
  }
  | {
    kind: 'plan'
    entries: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  }

  /** One model delta surfaced while the request is still active. */
  | {
    kind: 'agent-stream'
    channel: 'message' | 'thought'
    messageId: string
    text: string
  }

function streamMessageId(turn: number, step: number): string {
  return `dsh-stream-${turn}-${step}`
}

/**
 * Project one durable Session event into client-visible semantic facts.
 *
 * Surface replacements and plugin-authored user-role messages are model-facing
 * context, not human-visible transcript entries. Only human-authored user
 * messages and append-origin assistant/tool-result events are emitted.
 * Non-surface tool calls and whole-list todo state remain visible.
 *
 * @param event Durable Session event to project.
 * @param streamedTextBlockIndexes Text blocks already projected from stream deltas.
 * @returns Zero or more client-visible semantic projections.
 */
export function eventToAcpProjections(
  event: SessionEvent,
  streamedTextBlockIndexes: ReadonlySet<number> = new Set(),
): AcpProjection[] {
  switch (event.type) {
    case 'assistant/chunk': {
      const { chunk, turn, step } = event.data
      if (chunk.type === 'text-delta' && chunk.text.length > 0) {
        return [{ kind: 'agent-stream', channel: 'message', messageId: streamMessageId(turn, step), text: chunk.text }]
      }
      if (chunk.type === 'reasoning-delta' && chunk.text.length > 0) {
        return [{ kind: 'agent-stream', channel: 'thought', messageId: streamMessageId(turn, step), text: chunk.text }]
      }
      return []
    }
    case 'user/message':
      return event.surfaceOp === 'append' && event.data.source.kind === 'user'
        ? [{ kind: 'message', role: 'user', messageId: event.data.id, blocks: event.data.content }]
        : []
    case 'assistant/message':
      return event.surfaceOp === 'append' && event.data.message.content.length > 0
        ? [{
          kind: 'message',
          role: 'agent',
          messageId: event.data.message.id,
          // Text deltas already crossed the wire while the model was running.
          // Keep blocks without a delta (images and adapters that only emit a
          // block-end) so ACP remains lossless for every stream dialect.
          blocks: event.data.message.content.filter((block, index) => (
            block.type !== 'reasoning' && !(block.type === 'text' && streamedTextBlockIndexes.has(index))
          )),
        }]
        : []
    case 'tool/call':
      return [{
        kind: 'tool-call',
        toolCallId: event.data.callId,
        title: event.data.name,
        rawArguments: event.data.arguments,
      }]
    case 'tool/result': {
      if (event.surfaceOp !== 'append') return []
      const result = event.data.message.content[0]
      return [{
        kind: 'tool-result',
        toolCallId: result.toolCallId,
        isError: result.isError === true,
        blocks: result.content,
      }]
    }
    case 'todo/write':
      return [{ kind: 'plan', entries: event.data.todos }]
    default:
      return []
  }
}

/**
 * Preserve malformed model JSON as opaque input instead of dropping a tool call.
 *
 * @param value Model-produced tool arguments.
 * @returns Parsed JSON or the original string when parsing fails.
 */
export function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (_invalidModelJson) {
    return value
  }
}
