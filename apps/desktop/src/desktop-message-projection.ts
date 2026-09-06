/** Desktop-only display projection for durable ACP prompt references. */

import type { ContentBlock, SessionEvent } from '@deepseek-ai/dsh-client-connection/client'

type SyntheticSessionEvent = SessionEvent extends infer Event
  ? Event extends SessionEvent ? Omit<Event, 'seq' | 'time'> : never
  : never

const RESOURCE_LINK = /\n?\[resource_link name=("(?:\\.|[^"\\])*") uri="(?:\\.|[^"\\])*"(?: [^\]\n]+)?\]\n?/gu

/** Coalesce adjacent text-like blocks without changing block order. */
export function appendDesktopMessageBlocks(target: ContentBlock[], blocks: readonly ContentBlock[]): void {
  for (const block of blocks) {
    const previous = target.at(-1)
    if (block.type === 'text' && previous?.type === 'text') previous.text += block.text
    else if (block.type === 'reasoning' && previous?.type === 'reasoning') previous.text += block.text
    else target.push({ ...block })
  }
}

/**
 * Accumulate assistant blocks within one model step and reset at a tool boundary.
 * @param previous - Blocks already projected for the current synthetic step.
 * @param additions - Newly received ACP message blocks.
 * @param followsTool - Whether a tool group separates the additions from the previous blocks.
 * @returns Detached, coalesced blocks for the receiving model step.
 */
export function accumulateDesktopAssistantBlocks(
  previous: readonly ContentBlock[],
  additions: readonly ContentBlock[],
  followsTool: boolean,
): ContentBlock[] {
  const blocks: ContentBlock[] = followsTool ? [] : previous.map(block => ({ ...block }))
  appendDesktopMessageBlocks(blocks, additions)
  return blocks
}

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
