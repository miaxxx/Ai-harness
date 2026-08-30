/** Desktop-only display projection for durable ACP prompt references. */

import type { ContentBlock, SessionEvent } from '@deepseek-ai/dsh-client-connection/client'

type SyntheticSessionEvent = SessionEvent extends infer Event
  ? Event extends SessionEvent ? Omit<Event, 'seq' | 'time'> : never
  : never

const RESOURCE_LINK = /\n?\[resource_link name=("(?:\\.|[^"\\])*") uri="(?:\\.|[^"\\])*"\]\n?/gu

/**
 * Replace ACP's durable ordinary-file reference with the shared file-chip token.
 * The Runtime keeps the original resource link; only the Desktop transcript omits its local URI.
 * @param text - Durable user-message text received through ACP.
 * @returns Text suitable for the Desktop conversation projection.
 */
export function projectDesktopUserText(text: string): string {
  return text.replace(RESOURCE_LINK, (_match, encodedName: string) => {
    let name = '附件'
    try { name = JSON.parse(encodedName) as string } catch { /* ACP owns the generated JSON string. */ }
    return `\n@"${name.replaceAll('"', "'")}"\n`
  })
}

/**
 * Project accumulated ACP assistant content into streaming or finalized Session events.
 * @param blocks - All assistant blocks accumulated in the current synthetic step.
 * @param running - Whether ACP still owns an active prompt.
 * @param turn - Synthetic turn number.
 * @param step - Synthetic step number.
 * @param id - Message id used by the finalized projection.
 * @returns Ordered events consumed by the shared conversation assembler.
 */
export function projectDesktopAssistant(
  blocks: readonly ContentBlock[],
  running: boolean,
  turn: number,
  step: number,
  id: SessionEvent<'assistant/message'>['data']['message']['id'],
): SyntheticSessionEvent[] {
  if (!running) {
    return [{
      type: 'assistant/message',
      data: {
        turn,
        step,
        message: {
          id,
          role: 'assistant',
          content: [...blocks],
          source: { kind: 'model', provider: 'acp', model: 'runtime' },
        },
      },
      surfaceOp: 'append',
    }]
  }
  const events: SyntheticSessionEvent[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block?.type !== 'text' && block?.type !== 'reasoning') continue
    events.push({
      type: 'assistant/chunk',
      data: { turn, step, chunk: { type: 'block-start', index, blockType: block.type } },
    })
    events.push({
      type: 'assistant/chunk',
      data: {
        turn,
        step,
        chunk: block.type === 'reasoning'
          ? { type: 'reasoning-delta', index, text: block.text }
          : { type: 'text-delta', index, text: block.text },
      },
    })
  }
  return events
}
