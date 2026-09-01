import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import ComputerRuntime from '@deepseek-ai/dsh-computer'
import type { ComputerAction, ComputerProvider } from '@deepseek-ai/dsh-computer'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolComputer from '@deepseek-ai/dsh-tool-computer'
import * as ToolComputerInvariant from '@deepseek-ai/dsh-tool-computer/invariant'

const signal = new AbortController().signal
const contexts: Context[] = []
const limits: ImageAttachmentLimits = { maxImageBytes: 1024, maxImagesPerMessage: 2, maxMessageImageBytes: 2048, maxImagePixels: 1024, maxImageDimension: 1024, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }
class Attachments extends AttachmentStore {
  readonly imageLimits = limits
  readonly saved: SaveImageAttachment[] = []
  validateImage(): Promise<void> { return Promise.resolve() }
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    return Promise.resolve({ attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`), mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1 })
  }
  readImage(): Promise<StoredImageAttachment> { throw new Error('not used') }
}
interface Harness { ctx: Context; actions: ComputerAction[]; attachments: Attachments }
async function harness(): Promise<Harness> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(Attachments); await ctx.plugin(ComputerRuntime)
  const actions: ComputerAction[] = []
  let generation = 0
  const provider: ComputerProvider = {
    id: 'test', targetKinds: ['app', 'desktop'], available: () => true,
    listTargets: () => Promise.resolve([{ kind: 'desktop', id: 'desktop', name: 'Desktop' }, { kind: 'app', id: 'Editor', name: 'Editor' }]),
    observe: (target, mode) => {
      const id = `obs-${++generation}`
      return Promise.resolve({
        id, target,
        ...(target.kind === 'app' ? { title: 'Document' } : {}),
        ...(mode === 'visual' ? {} : { accessibility: { text: `state-${generation}`, elements: [{ id: `${id}:0`, role: 'button', label: 'Save', value: String(generation), enabled: true, focused: false, actions: ['click'] }] } }),
        ...(mode === 'accessibility' ? {} : { visual: { scope: target.kind === 'desktop' ? 'desktop' as const : 'window' as const, image: { data: new Uint8Array([1]), mediaType: 'image/png' as const } } }),
      })
    },
    perform: (target, action) => {
      actions.push(action)
      const id = `obs-${++generation}`
      return Promise.resolve({ id, target, accessibility: { text: `state-${generation}`, elements: [{ id: `${id}:0`, role: 'button', label: 'Save', value: String(generation), enabled: true, focused: true, actions: ['click'] }] } })
    },
  }
  ctx.computer.register(provider); await ctx.plugin(ToolComputer)
  return { ctx, actions, attachments: ctx.attachments as Attachments }
}
function execute(ctx: Context, arguments_: Record<string, unknown>, agentId?: string) {
  return ctx.tools.execute({ name: 'computer', arguments: arguments_, signal, callId: 'computer-test' as never, ...(agentId === undefined ? {} : { agent: { id: agentId } as never }) })
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('computer tool', () => {
  it('lists targets and observes a named app directly without a discovery round trip', async () => {
    const { ctx } = await harness()
    expect(await execute(ctx, { action: 'list' })).toMatchObject({ isError: false, value: { targets: [{ kind: 'desktop' }, { kind: 'app', name: 'Editor' }] } })
    expect(await execute(ctx, { action: 'observe', targetKind: 'app', target: 'Editor' }, 'agent-a')).toMatchObject({ isError: false, value: { target: { id: 'Editor' }, accessibility: { text: 'state-1' } } })
  })

  it('keeps visual observation behind approval and persists the image', async () => {
    const { ctx, attachments } = await harness()
    const get = vi.spyOn(ctx, 'get').mockReturnValue(undefined)
    expect(await execute(ctx, { action: 'observe', targetKind: 'desktop', observation: 'visual' }, 'agent-a')).toMatchObject({ isError: true })
    get.mockReturnValue({ request: vi.fn().mockResolvedValue('allowed-once') })
    expect(await execute(ctx, { action: 'observe', targetKind: 'desktop', observation: 'visual' }, 'agent-a')).toMatchObject({ isError: false })
    expect(attachments.saved).toHaveLength(1)
  })

  it('requires one-shot approval for mutations and rejects stale or cross-agent element ids', async () => {
    const { ctx } = await harness()
    const observed = await execute(ctx, { action: 'observe', target: 'Editor' }, 'agent-a')
    const elementId = (observed.value as { accessibility: { elements: Array<{ id: string }> } }).accessibility.elements[0]!.id
    const get = vi.spyOn(ctx, 'get').mockReturnValue(undefined)
    expect(await execute(ctx, { action: 'click', target: 'Editor', elementId }, 'agent-a')).toMatchObject({ isError: true })
    get.mockReturnValue({ request: vi.fn().mockResolvedValue('allowed-once') })
    expect(await execute(ctx, { action: 'click', target: 'Editor', elementId }, 'agent-b')).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'click', target: 'Editor', elementId }, 'agent-a')).toMatchObject({ isError: false })
    expect(await execute(ctx, { action: 'click', target: 'Editor', elementId }, 'agent-a')).toMatchObject({ isError: true })
  })

  it('expires cached element ids after the bounded observation window', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { ctx } = await harness()
    const observed = await execute(ctx, { action: 'observe', target: 'Editor' }, 'agent-a')
    const elementId = (observed.value as { accessibility: { elements: Array<{ id: string }> } }).accessibility.elements[0]!.id
    vi.spyOn(ctx, 'get').mockReturnValue({ request: vi.fn().mockResolvedValue('allowed-once') })
    clock.mockReturnValue(31_001)
    expect(await execute(ctx, { action: 'click', target: 'Editor', elementId }, 'agent-a')).toMatchObject({ isError: true })
  })

  it('maps the complete bounded action vocabulary and returns a semantic diff after element actions', async () => {
    const { ctx, actions } = await harness()
    vi.spyOn(ctx, 'get').mockReturnValue({ request: vi.fn().mockResolvedValue('allowed-once') })
    const observe = async () => {
      const result = await execute(ctx, { action: 'observe', target: 'Editor' }, 'agent-a')
      return (result.value as { accessibility: { elements: Array<{ id: string }> } }).accessibility.elements[0]!.id
    }
    let id = await observe()
    expect(await execute(ctx, { action: 'click', target: 'Editor', elementId: id, button: 'right', double: true }, 'agent-a')).toMatchObject({ isError: false, value: { diff: expect.any(String) } })
    id = await observe(); await execute(ctx, { action: 'set_value', target: 'Editor', elementId: id, value: '' }, 'agent-a')
    id = await observe(); await execute(ctx, { action: 'type_text', target: 'Editor', elementId: id, text: 't' }, 'agent-a')
    id = await observe(); await execute(ctx, { action: 'paste', target: 'Editor', elementId: id, text: 'p' }, 'agent-a')
    id = await observe(); await execute(ctx, { action: 'scroll', target: 'Editor', elementId: id, direction: 'left', amount: 120 }, 'agent-a')
    id = await observe(); await execute(ctx, { action: 'secondary_action', target: 'Editor', elementId: id }, 'agent-a')
    await execute(ctx, { action: 'drag', target: 'Editor', x: 1, y: 2, toX: 3, toY: 4 }, 'agent-a')
    await execute(ctx, { action: 'key', target: 'Editor', key: 'Return', modifiers: ['meta'] }, 'agent-a')
    await execute(ctx, { action: 'scroll', target: 'Editor', x: 5, y: 6, direction: 'down' }, 'agent-a')
    expect(actions.map(action => action.kind)).toEqual(['click', 'set_value', 'type_text', 'paste', 'scroll', 'secondary_action', 'drag', 'key', 'scroll'])
    expect(actions[0]).toMatchObject({ kind: 'click', button: 'right', count: 2 })
    expect(actions[1]).toEqual(expect.objectContaining({ kind: 'set_value', value: '' }))
  })

  it('renders target lists, full observations, diffs, images, and call metadata', async () => {
    const { ctx } = await harness(); const tool = ctx.tools.get('computer')!
    expect(tool.output.render({}, { targets: [] })).toEqual([{ type: 'text', text: 'No controllable targets are visible.' }])
    expect(tool.output.render({}, { target: { kind: 'app', id: 'Editor', name: 'Editor' }, accessibility: { text: 'hello', elements: [], partial: true } })[0]).toMatchObject({ type: 'text' })
    expect(tool.output.render({}, { target: { kind: 'app', id: 'Editor', name: 'Editor' }, diff: 'No semantic change detected.', visual: { scope: 'window', image: {} } })).toHaveLength(2)
    expect(tool.presentCall?.({ action: 'observe' })).toMatchObject({ title: 'Computer: observe' })
  })

  it('registers its invariant companion', async () => {
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ToolComputerInvariant)).resolves.toBeDefined()
  })
})
