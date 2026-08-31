import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ComputerProvider } from '@deepseek-ai/dsh-computer'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MacComputer from '@deepseek-ai/dsh-computer-macos'
import * as MacComputerInvariant from '@deepseek-ai/dsh-computer-macos/invariant'

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

type ExecCallback = (error: Error | null, stdout: string) => void

const contexts: Context[] = []
const snapshot = {
  name: 'Editor', title: 'Document', text: 'hello',
  elements: [{ id: '0', role: 'AXButton', label: 'Save', enabled: true }],
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
      void writeFile(path, new Uint8Array([1, 2, 3])).then(
        () => { callback(null, '') },
        (error: unknown) => { callback(error instanceof Error ? error : new Error(String(error)), '') },
      )
    } else if (args.at(-1)?.includes('applicationProcesses.whose')) {
      callback(null, JSON.stringify([{ id: 'Editor', name: 'Editor' }]))
    } else {
      callback(null, JSON.stringify(snapshot))
    }
    return undefined
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('macOS computer Provider', () => {
  it('reports platform availability and lists visible applications', async () => {
    const provider = capture()
    const original = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    expect(provider.available()).toBe(false)
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
    expect(provider.available()).toBe(true)
    const controller = new AbortController()
    await expect(provider.listApps(controller.signal)).resolves.toEqual([{ id: 'Editor', name: 'Editor' }])
    expect(execFileMock).toHaveBeenLastCalledWith(
      '/usr/bin/osascript', expect.any(Array), expect.objectContaining({ signal: controller.signal }), expect.any(Function),
    )
  })

  it('inspects accessibility content with and without screenshots', async () => {
    const provider = capture()
    await expect(provider.inspect('Editor', false)).resolves.toMatchObject({ title: 'Document', text: 'hello' })
    const image = await provider.inspect('Editor', true)
    expect(image).toMatchObject({ screenshot: { mediaType: 'image/png', name: 'Editor-snapshot.png' } })
    expect(image.screenshot?.data).toEqual(new Uint8Array([1, 2, 3]))

    execFileMock.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(null, JSON.stringify({ ...snapshot, title: undefined }))
    })
    await expect(provider.inspect('Editor', false)).resolves.not.toHaveProperty('title')
  })

  it('builds fixed scripts for every bounded action', async () => {
    const provider = capture()
    for (const action of [
      { kind: 'click' as const, elementId: '0' },
      { kind: 'type' as const, elementId: '1', text: 'hello' },
      { kind: 'key' as const, key: 'Return' },
      { kind: 'scroll' as const, elementId: '2', direction: 'up' as const },
      { kind: 'scroll' as const, elementId: '3', direction: 'down' as const },
    ]) await expect(provider.act('Editor', action)).resolves.toMatchObject({ app: { name: 'Editor' } })
    const scripts = execFileMock.mock.calls.map(call => String((call[1] as string[]).at(-1)))
    expect(scripts.some(script => script.includes('.click()'))).toBe(true)
    expect(scripts.some(script => script.includes('keystroke'))).toBe(true)
    expect(scripts.some(script => script.includes('keyCode'))).toBe(true)
    expect(scripts.some(script => script.includes('AXScrollUp'))).toBe(true)
    expect(scripts.some(script => script.includes('AXScrollDown'))).toBe(true)
  })

  it('surfaces subprocess and malformed JSON failures while cleaning screenshot files', async () => {
    const provider = capture()
    execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(new Error('osascript failed'), '')
    })
    await expect(provider.listApps()).rejects.toThrow('osascript failed')
    execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(null, '{')
    })
    await expect(provider.listApps()).rejects.toThrow()
    execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(null, JSON.stringify(snapshot))
    }).mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(new Error('screenshot failed'), '')
    })
    await expect(provider.inspect('Editor', true)).rejects.toThrow('screenshot failed')
  })

  it('registers its invariant companion', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(MacComputerInvariant)).resolves.toBeDefined()
  })
})
