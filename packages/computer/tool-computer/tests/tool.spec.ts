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
const limits: ImageAttachmentLimits = {
  maxImageBytes: 1024, maxImagesPerMessage: 2, maxMessageImageBytes: 2048,
  maxImagePixels: 1024, maxImageDimension: 1024,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

class Attachments extends AttachmentStore {
  readonly imageLimits = limits
  readonly saved: SaveImageAttachment[] = []
  validateImage(): Promise<void> { return Promise.resolve() }
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`), mediaType: input.mediaType,
      bytes: input.data.byteLength, width: 1, height: 1,
    })
  }
  readImage(): Promise<StoredImageAttachment> { throw new Error('not used') }
}

interface Harness {
  ctx: Context
  actions: ComputerAction[]
  attachments: Attachments
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Attachments)
  await ctx.plugin(ComputerRuntime)
  const actions: ComputerAction[] = []
  const provider: ComputerProvider = {
    id: 'test', available: () => true,
    listApps: () => Promise.resolve([{ id: 'app', name: 'Editor' }]),
    inspect: (app, includeScreenshot) => Promise.resolve({
      app: { id: app, name: 'Editor' }, title: 'Document', text: 'hello',
      elements: [{ id: '0', role: 'button', label: 'Save', enabled: false }],
      ...(includeScreenshot ? { screenshot: { data: new Uint8Array([1]), mediaType: 'image/png' as const } } : {}),
    }),
    act: (app, action) => {
      actions.push(action)
      return Promise.resolve({ app: { id: app, name: 'Editor' }, text: 'done', elements: [] })
    },
  }
  ctx.computer.register(provider)
  await ctx.plugin(ToolComputer)
  return { ctx, actions, attachments: ctx.attachments as Attachments }
}

function execute(ctx: Context, arguments_: Record<string, unknown>, withAgent = false) {
  return ctx.tools.execute({
    name: 'computer', arguments: arguments_, signal, callId: 'computer-test' as never,
    ...(withAgent ? { agent: { id: 'agent' } as never } : {}),
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('computer tool', () => {
  it('lists and inspects apps, including an approved durable screenshot', async () => {
    const { ctx, attachments } = await harness()
    expect(await execute(ctx, { action: 'list' })).toMatchObject({ isError: false, value: { apps: [{ name: 'Editor' }] } })
    expect(await execute(ctx, { action: 'inspect', app: 'app' })).toMatchObject({ isError: false, value: { text: 'hello' } })

    vi.spyOn(ctx, 'get').mockReturnValue({ request: vi.fn().mockResolvedValue('allowed-once') })
    const screenshot = await execute(ctx, { action: 'inspect', app: 'app', screenshot: true }, true)
    expect(screenshot).toMatchObject({ isError: false })
    expect(attachments.saved).toHaveLength(1)
  })

  it('requires approval support for screenshots and mutations', async () => {
    const { ctx } = await harness()
    vi.spyOn(ctx, 'get').mockReturnValue(undefined)
    expect(await execute(ctx, { action: 'inspect', app: 'app', screenshot: true })).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'inspect', app: 'app', screenshot: true }, true)).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'click', app: 'app', elementId: '0' })).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'click', app: 'app', elementId: '0' }, true)).toMatchObject({ isError: true })

    vi.spyOn(ctx, 'get').mockReturnValue({ request: vi.fn().mockResolvedValue('rejected') })
    expect(await execute(ctx, { action: 'inspect', app: 'app', screenshot: true }, true)).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'click', app: 'app', elementId: '0' }, true)).toMatchObject({ isError: true })
  })

  it('maps every approved action and validates required arguments', async () => {
    const { ctx, actions } = await harness()
    vi.spyOn(ctx, 'get').mockReturnValue({ request: vi.fn().mockResolvedValue('allowed-once') })
    expect(await execute(ctx, { action: 'inspect' }, true)).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'click', app: 'app', elementId: 'bad' }, true)).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'type', app: 'app', elementId: '0' }, true)).toMatchObject({ isError: true })
    expect(await execute(ctx, { action: 'key', app: 'app' }, true)).toMatchObject({ isError: true })

    for (const arguments_ of [
      { action: 'click', app: 'app', elementId: '0' },
      { action: 'type', app: 'app', elementId: '1', text: 'hello' },
      { action: 'key', app: 'app', key: 'Return' },
      { action: 'scroll', app: 'app', elementId: '2', direction: 'up' },
      { action: 'scroll', app: 'app', elementId: '3' },
    ]) expect(await execute(ctx, arguments_, true)).toMatchObject({ isError: false })
    expect(actions).toEqual([
      { kind: 'click', elementId: '0' },
      { kind: 'type', elementId: '1', text: 'hello' },
      { kind: 'key', key: 'Return' },
      { kind: 'scroll', elementId: '2', direction: 'up' },
      { kind: 'scroll', elementId: '3', direction: 'down' },
    ])
  })

  it('renders app lists, snapshots, images, and presentation metadata', async () => {
    const { ctx } = await harness()
    const tool = ctx.tools.get('computer')!
    expect(tool.output.render({}, { apps: [] })).toEqual([{ type: 'text', text: 'No controllable applications are visible.' }])
    expect(tool.output.render({}, { apps: [{ id: 'one', name: 'One' }] })).toEqual([{ type: 'text', text: '- One (one)' }])
    expect(tool.output.render({}, {
      app: {}, text: '', elements: [{ id: '0', role: 'button', label: 'Save', enabled: false }], screenshot: {},
    })).toHaveLength(2)
    expect(tool.output.render({}, {
      app: { name: 'Editor' }, title: 'Document', elements: [{ id: '1', role: 'input', label: 'Name', enabled: true }],
    })[0]).toMatchObject({ type: 'text', text: 'App: Editor\nWindow: Document\n[1] input: Name' })
    expect(tool.output.render({}, { text: '', screenshot: 'not-an-image' })).toHaveLength(1)
    expect(tool.presentCall?.({ action: 'list' })).toMatchObject({ title: 'Computer: list' })
  })

  it('registers its invariant companion', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ToolComputerInvariant)).resolves.toBeDefined()
  })
})
