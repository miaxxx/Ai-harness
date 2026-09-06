import { describe, expect, it } from 'vitest'
import {
  accumulateDesktopAssistantBlocks,
  projectDesktopAssistant,
  projectDesktopUserText,
} from '../src/desktop-message-projection.ts'

describe('Desktop message projection', () => {
  it('projects an ACP resource link as a file-chip token without its URI', () => {
    const projected = projectDesktopUserText(
      '请处理\n[resource_link name="writing-block.md" uri="file:///Users/miao/.dsh/artifacts/input.md" mime_type="text/markdown" size=12]\n',
    )
    expect(projected).toBe('请处理\n@"writing-block.md"\n')
    expect(projected).not.toContain('file:///')
  })

  it('leaves ordinary user text unchanged', () => {
    expect(projectDesktopUserText('普通消息')).toBe('普通消息')
  })

  it('projects accumulated reasoning and text as live chunks', () => {
    const events = projectDesktopAssistant([
      { type: 'reasoning', text: '先检查文件' },
      { type: 'text', text: '完成' },
    ], true, 1, 1, 'message-1' as never)
    expect(events.map(event => event.type)).toEqual([
      'assistant/chunk', 'assistant/chunk', 'assistant/chunk', 'assistant/chunk',
    ])
    expect(events[1]).toMatchObject({
      data: { chunk: { type: 'reasoning-delta', text: '先检查文件' } },
    })
    expect(events[3]).toMatchObject({
      data: { chunk: { type: 'text-delta', text: '完成' } },
    })
  })

  it('keeps reasoning beside text in the finalized assistant message', () => {
    const blocks = [
      { type: 'reasoning' as const, text: '先检查文件' },
      { type: 'text' as const, text: '完成' },
    ]
    expect(projectDesktopAssistant(blocks, false, 1, 1, 'message-1' as never)).toMatchObject([{
      type: 'assistant/message',
      data: { message: { content: blocks } },
    }])
  })

  it('starts an empty assistant accumulator after a tool group', () => {
    const blocks = accumulateDesktopAssistantBlocks(
      [{ type: 'text', text: '工具调用前的答复' }],
      [{ type: 'text', text: '工具返回后的答复' }],
      true,
    )

    expect(blocks).toEqual([{ type: 'text', text: '工具返回后的答复' }])
  })

  it('coalesces reasoning and text fragments within one model step', () => {
    const blocks = accumulateDesktopAssistantBlocks(
      [{ type: 'reasoning', text: '先检查' }],
      [{ type: 'reasoning', text: '，再验证' }, { type: 'text', text: '完成' }],
      false,
    )

    expect(blocks).toEqual([
      { type: 'reasoning', text: '先检查，再验证' },
      { type: 'text', text: '完成' },
    ])
  })
})
