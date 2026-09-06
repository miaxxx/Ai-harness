/** Desktop prompt parts preserve inline attachment positions across the IPC boundary. */

/** One ordered piece of a Desktop prompt. */
export type DesktopPromptPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'attachment'; readonly attachmentId: string; readonly name: string }

const ATTACHMENT_MARKER = /\[\[desktop-attachment:([^\]\r\n]+)\]\]/gu

/**
 * Serialize a Desktop attachment reference for the input machine.
 * @param reference - Encoded staged attachment identity and display name local to this Session.
 * @returns Model-only marker replaced by the Main process with the attachment block.
 */
export function desktopAttachmentMarker(reference: string): string {
  return `[[desktop-attachment:${reference}]]`
}

/**
 * Build the private reference stored in one inline composer occurrence.
 * @param attachment - Staged attachment identity and user-visible file name.
 * @returns Opaque reference that preserves the display name until the user message arrives back from ACP.
 */
export function desktopAttachmentReference(attachment: { id: string; name: string }): string {
  return `${attachment.id}|${encodeURIComponent(attachment.name)}`
}

function attachmentPart(reference: string): Extract<DesktopPromptPart, { type: 'attachment' }> | undefined {
  const [attachmentId, encodedName] = reference.split('|', 2)
  if (attachmentId === undefined || attachmentId === '') return undefined
  if (encodedName === undefined || encodedName === '') return { type: 'attachment', attachmentId, name: '附件' }
  try {
    const name = decodeURIComponent(encodedName)
    return name === '' ? { type: 'attachment', attachmentId, name: '附件' } : { type: 'attachment', attachmentId, name }
  } catch {
    return { type: 'attachment', attachmentId, name: '附件' }
  }
}

/**
 * Split serialized composer text into ACP prompt parts without changing their order.
 * @param text - Input-machine serialized draft.
 * @returns Text and attachment parts in their original order.
 */
export function splitDesktopPrompt(text: string): DesktopPromptPart[] {
  const parts: DesktopPromptPart[] = []
  let cursor = 0
  ATTACHMENT_MARKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTACHMENT_MARKER.exec(text)) !== null) {
    const before = text.slice(cursor, match.index)
    if (before !== '') parts.push({ type: 'text', text: before })
    const reference = match[1]
    if (reference !== undefined) {
      const attachment = attachmentPart(reference)
      if (attachment !== undefined) parts.push(attachment)
    }
    cursor = match.index + match[0].length
  }
  const tail = text.slice(cursor)
  if (tail !== '') parts.push({ type: 'text', text: tail })
  return parts
}

/**
 * Project submitted parts into the Desktop transcript's reference token syntax.
 * @param parts - Ordered prompt pieces admitted from the composer.
 * @returns Display text that preserves every attachment reference and its location.
 */
export function desktopPromptDisplay(parts: readonly DesktopPromptPart[]): string {
  return parts.map(part => part.type === 'text'
    ? part.text
    : `@"${part.name.replaceAll('"', "'")}"`).join('')
}
