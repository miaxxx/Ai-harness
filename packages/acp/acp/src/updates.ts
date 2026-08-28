/** ACP wire materialization for pure durable-event projections. */

import type { ContentBlock as AcpContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import { assistantBlockToAcp } from './content.ts'
import { type AcpProjection, parseToolArguments } from './projection.ts'

/**
 * Materialize one pure semantic projection, including attachment IO at the protocol boundary.
 *
 * @param ctx Cordis context used to resolve attachment content.
 * @param projection Semantic projection to convert.
 * @returns ACP session updates for the projection.
 */
export async function projectionToAcpUpdates(
  ctx: Context,
  projection: AcpProjection,
): Promise<SessionUpdate[]> {
  switch (projection.kind) {
    case 'message': {
      const updates: SessionUpdate[] = []
      for (const block of projection.blocks) {
        // Reasoning is intentionally not part of the committed transcript wire.
        if (block.type === 'reasoning') continue
        const content = await assistantBlockToAcp(ctx, block)
        if (content === undefined) continue
        updates.push({
          sessionUpdate: projection.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
          messageId: projection.messageId,
          content,
        })
      }
      return updates
    }
    case 'tool-call':
      return [{
        sessionUpdate: 'tool_call',
        toolCallId: projection.toolCallId,
        title: projection.title,
        kind: 'other',
        status: 'in_progress',
        rawInput: parseToolArguments(projection.rawArguments),
      }]
    case 'tool-result': {
      const content: ToolCallContent[] = []
      for (const block of projection.blocks) {
        const converted: AcpContentBlock | undefined = await assistantBlockToAcp(ctx, block)
        if (converted !== undefined) content.push({ type: 'content', content: converted })
      }
      return [{
        sessionUpdate: 'tool_call_update',
        toolCallId: projection.toolCallId,
        status: projection.isError ? 'failed' : 'completed',
        content,
      }]
    }
    case 'plan':
      return [{
        sessionUpdate: 'plan',
        entries: projection.entries.map(entry => ({
          content: entry.content,
          status: entry.status,
          priority: 'medium',
        })),
      }]
  }
}
