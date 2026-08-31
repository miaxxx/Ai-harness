import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ComputerAction, ComputerProvider } from '@deepseek-ai/dsh-computer'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MacComputer from '@deepseek-ai/dsh-computer-macos'
import * as MacComputerInvariant from '@deepseek-ai/dsh-computer-macos/invariant'

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execFileMock }))
type ExecCallback = (error: Error | null, stdout: string) => void
const contexts: Context[] = []
const snapshot = {
  name: 'Editor', title: 'Document', text: 'hello', partial: false,
  elements: [{ id: 'observation:0', role: 'AXButton', label: 'Save', value: '', enabled: true, focused: false, actions: ['AXPress'] }],
}
function capture(): ComputerProvider {
  let provider: ComputerProvider | undefined
  MacComputer.apply({ computer: { register(value: ComputerProvider) { provider = value } } } as never)
  if (provider === undefined) throw new Error('provider was not registered')
  return provider
}
beforeEach(() => {
  execFileMock.mockImplementation((file: string, args: string[], _options: unknown, callback: ExecCallback) => {
    if (file === '/usr/sbin/screencapture') {
      const path = args.at(-1)
      if (path === undefined) throw new Error('missing screenshot path')
      void writeFile(path, new Uint8Array([1, 2, 3])).then(() => callback(null, ''), error => callback(error as Error, ''))
    } else {
      const script = String(args.at(-1))
      if (script.includes('applicationProcesses.whose')) callback(null, JSON.stringify([{ id: 'Editor', name: 'Editor' }]))
      else if (script.includes('JSON.stringify({ok:true})')) callback(null, JSON.stringify({ ok: true }))
      else callback(null, JSON.stringify(snapshot))
    }
    return undefined
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('macOS computer Provider', () => {
  it('declares native target kinds and discovers Desktop plus apps', async () => {
    const provider = capture()
    expect(provider.targetKinds).toEqual(['app', 'desktop'])
    const original = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    expect(provider.available()).toBe(false)
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
    await expect(provider.listTargets()).resolves.toEqual([
      { kind: 'desktop', id: 'desktop', name: 'Desktop' },
      { kind: 'app', id: 'Editor', name: 'Editor' },
    ])
  })

  it('returns bounded recursive accessibility state and honest visual scope', async () => {
    const provider = capture()
    await expect(provider.observe({ kind: 'app', id: 'Editor', name: 'Editor' }, 'accessibility')).resolves.toMatchObject({
      target: { kind: 'app', id: 'Editor' }, title: 'Document', accessibility: { text: 'hello' },
    })
    await expect(provider.observe({ kind: 'app', id: 'Editor', name: 'Editor' }, 'visual')).rejects.toThrow('WINDOW_UNAVAILABLE')
    const desktop = await provider.observe({ kind: 'desktop', id: 'desktop', name: 'Desktop' }, 'visual')
    expect(desktop.visual).toMatchObject({ scope: 'desktop', image: { mediaType: 'image/png', name: 'desktop.png' } })
    expect(desktop.visual?.image.data).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('builds only fixed scripts for the minimum useful action set and re-observes afterward', async () => {
    const provider = capture()
    const target = { kind: 'app' as const, id: 'Editor', name: 'Editor' }
    const actions: ComputerAction[] = [
      { kind: 'click', elementId: 'latest:0', button: 'left', count: 2 },
      { kind: 'click', point: { x: 10, y: 20 }, button: 'right', count: 1 },
      { kind: 'drag', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } },
      { kind: 'set_value', elementId: 'latest:0', value: 'value' },
      { kind: 'type_text', elementId: 'latest:0', text: 'hello' },
      { kind: 'paste', elementId: 'latest:0', text: 'paste' },
      { kind: 'key', key: 'Return', modifiers: ['meta'] },
      { kind: 'scroll', elementId: 'latest:0', direction: 'left', amount: 100 },
      { kind: 'scroll', point: { x: 1, y: 2 }, direction: 'down', amount: 100 },
      { kind: 'secondary_action', elementId: 'latest:0' },
    ]
    for (const action of actions) await expect(provider.perform(target, action)).resolves.toHaveProperty('accessibility')
    const scripts = execFileMock.mock.calls.map(call => String((call[1] as string[]).at(-1)))
    expect(scripts.some(script => script.includes('CGEventCreateMouseEvent'))).toBe(true)
    expect(scripts.some(script => script.includes('CGEventLeftMouseDragged'))).toBe(true)
    expect(scripts.some(script => script.includes('setTheClipboardTo'))).toBe(true)
    expect(scripts.some(script => script.includes('AXShowMenu'))).toBe(true)
    expect(scripts.some(script => script.includes('AXScrollLeft'))).toBe(true)
  })

  it('maps stable permission, stale-element, and capture failures', async () => {
    const provider = capture()
    execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => callback(new Error('Not authorized to send Apple events'), ''))
    await expect(provider.listTargets()).rejects.toThrow('COMPUTER_PERMISSION_REQUIRED')
    await expect(provider.perform({ kind: 'app', id: 'Editor', name: 'Editor' }, { kind: 'click', elementId: 'bad', button: 'left', count: 1 })).rejects.toThrow('ELEMENT_EXPIRED')
    execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => callback(new Error('screenshot failed'), ''))
    await expect(provider.observe({ kind: 'desktop', id: 'desktop', name: 'Desktop' }, 'visual')).rejects.toThrow('CAPTURE_FAILED')
  })

  it('registers its invariant companion', async () => {
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(MacComputerInvariant)).resolves.toBeDefined()
  })
})
