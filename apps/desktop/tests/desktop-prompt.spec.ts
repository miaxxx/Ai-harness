import { describe, expect, it } from 'vitest'
import {
  desktopAttachmentMarker,
  desktopAttachmentReference,
  desktopPromptDisplay,
  splitDesktopPrompt,
} from '../src/desktop-prompt.ts'

describe('Desktop prompt references', () => {
  it('keeps repeated attachment references in their exact text positions', () => {
    const image = desktopAttachmentMarker(desktopAttachmentReference({ id: 'image-id', name: '设计图.png' }))
    const html = desktopAttachmentMarker(desktopAttachmentReference({ id: 'html-id', name: 'index.html' }))

    expect(splitDesktopPrompt(`将${image}加入${html}，再检查${image}`)).toEqual([
      { type: 'text', text: '将' },
      { type: 'attachment', attachmentId: 'image-id', name: '设计图.png' },
      { type: 'text', text: '加入' },
      { type: 'attachment', attachmentId: 'html-id', name: 'index.html' },
      { type: 'text', text: '，再检查' },
      { type: 'attachment', attachmentId: 'image-id', name: '设计图.png' },
    ])
  })

  it('keeps legacy attachment markers readable with a neutral label', () => {
    expect(splitDesktopPrompt(desktopAttachmentMarker('legacy-id'))).toEqual([
      { type: 'attachment', attachmentId: 'legacy-id', name: '附件' },
    ])
  })

  it('keeps direct attachment references visible in the sent transcript', () => {
    expect(desktopPromptDisplay([
      { type: 'text', text: '将' },
      { type: 'attachment', attachmentId: 'image-id', name: '设计图.png' },
      { type: 'text', text: '加入 ' },
      { type: 'attachment', attachmentId: 'html-id', name: 'index.html' },
    ])).toBe('将@"设计图.png"加入 @"index.html"')
  })

  it('leaves ordinary text unchanged', () => {
    expect(splitDesktopPrompt('请分析这个文件')).toEqual([{ type: 'text', text: '请分析这个文件' }])
  })
})
