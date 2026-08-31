import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerProvider } from '@deepseek-ai/dsh-computer'

type Listener = (event: { data?: string }) => void
type ResponsePlan = { result?: Record<string, unknown>; error?: { message: string }; skip?: boolean; noId?: boolean }

const sockets: FakeSocket[] = []
let socketMode: 'open' | 'error' | 'manual' = 'open'
let responseFor: (request: { id: number; method: string; params: Record<string, unknown> }) => ResponsePlan = () => ({ result: {} })

class FakeSocket {
  readonly sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = []
  readonly listeners = new Map<string, Array<{ listener: Listener; once: boolean }>>()
  closed = false

  constructor(readonly url: string) {
    sockets.push(this)
    queueMicrotask(() => {
      if (socketMode === 'open') this.emit('open')
      if (socketMode === 'error') this.emit('error')
    })
  }

  addEventListener(type: string, listener: Listener, options?: { once?: boolean }): void {
    const entries = this.listeners.get(type) ?? []
    entries.push({ listener, once: options?.once === true })
    this.listeners.set(type, entries)
  }

  emit(type: string, event: { data?: string } = {}): void {
    const entries = [...(this.listeners.get(type) ?? [])]
    this.listeners.set(type, entries.filter(entry => !entry.once))
    for (const entry of entries) entry.listener(event)
  }

  send(text: string): void {
    const request = JSON.parse(text) as { id: number; method: string; params: Record<string, unknown> }
    this.sent.push(request)
    const plan = responseFor(request)
    if (plan.skip === true) return
    queueMicrotask(() => {
      const response = {
        ...(plan.noId === true ? {} : { id: request.id }),
        ...(plan.result === undefined ? {} : { result: plan.result }),
        ...(plan.error === undefined ? {} : { error: plan.error }),
      }
      this.emit('message', {
        data: JSON.stringify(response),
      })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }
}

function capture(module: { apply(ctx: unknown): void }): ComputerProvider {
  let provider: ComputerProvider | undefined
  module.apply({ computer: { register(value: ComputerProvider) { provider = value } } })
  if (provider === undefined) throw new Error('provider was not registered')
  return provider
}

async function load(endpoint = 'http://127.0.0.1:9222/') {
  vi.resetModules()
  vi.stubEnv('DSH_BROWSER_CDP_URL', endpoint)
  return await import('@deepseek-ai/dsh-computer-browser-cdp')
}

function targets(value: unknown, ok = true, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(value) }))
}

beforeEach(() => {
  sockets.splice(0)
  socketMode = 'open'
  responseFor = () => ({ result: {} })
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Chromium CDP computer Provider', () => {
  it('is unavailable and fails loud without an endpoint', async () => {
    const provider = capture(await load(''))
    expect(provider.available()).toBe(false)
    await expect(provider.listApps()).rejects.toThrow('DSH_BROWSER_CDP_URL')
  })

  it('validates target discovery and filters non-page records', async () => {
    const provider = capture(await load())
    expect(provider.available()).toBe(true)
    targets([], false, 503)
    await expect(provider.listApps()).rejects.toThrow('503')
    targets({})
    await expect(provider.listApps()).rejects.toThrow('invalid target list')
    targets([
      null,
      { type: 'worker', id: 'worker', title: 'Worker', url: 'worker:' },
      { type: 'page', title: 'Missing id', url: 'https://one' },
      { type: 'page', id: 'two', url: 'https://two' },
      { type: 'page', id: 'three', title: 'Missing URL' },
      { type: 'page', id: 'empty', title: '', url: 'https://empty', webSocketDebuggerUrl: 'ws://empty' },
      { type: 'page', id: 'named', title: 'Named', url: 'https://named', webSocketDebuggerUrl: 'ws://named' },
    ])
    const controller = new AbortController()
    await expect(provider.listApps(controller.signal)).resolves.toEqual([
      { id: 'empty', name: 'https://empty' }, { id: 'named', name: 'Named' },
    ])
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith('http://127.0.0.1:9222/json/list', { signal: controller.signal })
  })

  it('inspects text, elements, and screenshots over one scoped connection', async () => {
    const provider = capture(await load())
    targets([{ type: 'page', id: 'tab', title: 'Tab', url: 'https://tab', webSocketDebuggerUrl: 'ws://tab' }])
    responseFor = (request) => {
      if (request.method === 'Page.captureScreenshot') return { result: { data: Buffer.from([1, 2]).toString('base64') } }
      const expression = String(request.params.expression)
      if (expression === 'document.body.innerText') return { result: { result: { value: 'Page text' } } }
      return { result: { result: { value: [{ id: '0', role: 'button', label: 'Go', enabled: true }] } } }
    }
    await expect(provider.inspect('tab', true)).resolves.toMatchObject({
      title: 'Tab', text: 'Page text', elements: [{ label: 'Go' }], screenshot: { mediaType: 'image/png' },
    })
    expect(sockets[0]?.closed).toBe(true)

    responseFor = request => request.params.expression === 'document.body.innerText'
      ? { result: { result: { description: 'fallback text' } } }
      : { result: { result: {} } }
    await expect(provider.inspect('tab', false)).resolves.toMatchObject({ text: 'fallback text', elements: [] })

    responseFor = () => ({})
    await expect(provider.inspect('tab', false)).resolves.toMatchObject({ text: '', elements: [] })
  })

  it('rejects missing targets and invalid action element ids', async () => {
    const provider = capture(await load())
    targets([])
    await expect(provider.inspect('missing', false)).rejects.toThrow('no longer available')
    targets([{ type: 'page', id: 'tab', title: 'Tab', url: 'https://tab' }])
    await expect(provider.inspect('tab', false)).rejects.toThrow('no longer available')
    targets([{ type: 'page', id: 'tab', title: 'Tab', url: 'https://tab', webSocketDebuggerUrl: 'ws://tab' }])
    await expect(provider.act('tab', { kind: 'click', elementId: 'bad' })).rejects.toThrow('latest inspect')
    await expect(provider.act('tab', { kind: 'scroll', elementId: '', direction: 'down' })).rejects.toThrow('latest inspect')
  })

  it('sends click, type, key, and both scroll directions', async () => {
    const provider = capture(await load())
    targets([{ type: 'page', id: 'tab', title: 'Tab', url: 'https://tab', webSocketDebuggerUrl: 'ws://tab' }])
    responseFor = (request) => {
      if (request.method === 'Runtime.evaluate' && request.params.expression === 'document.body.innerText') return { result: { result: { value: '' } } }
      if (request.method === 'Runtime.evaluate' && String(request.params.expression).includes('.slice(0,80)')) return { result: { result: { value: [] } } }
      return { result: {} }
    }
    for (const action of [
      { kind: 'click' as const, elementId: '0' },
      { kind: 'type' as const, elementId: '1', text: 'hello' },
      { kind: 'key' as const, key: 'Return' },
      { kind: 'scroll' as const, elementId: '2', direction: 'up' as const },
      { kind: 'scroll' as const, elementId: '3', direction: 'down' as const },
    ]) await expect(provider.act('tab', action)).resolves.toMatchObject({ text: '' })
    const requests = sockets.flatMap(socket => socket.sent)
    expect(requests.some(request => request.method === 'Input.dispatchKeyEvent')).toBe(true)
    expect(requests.some(request => String(request.params.expression).includes('element.click()'))).toBe(true)
    expect(requests.some(request => String(request.params.expression).includes('isContentEditable'))).toBe(true)
    expect(requests.some(request => String(request.params.expression).includes('top:-600'))).toBe(true)
    expect(requests.some(request => String(request.params.expression).includes('top:600'))).toBe(true)
  })

  it('surfaces handshake, protocol, abort, and remote-close failures', async () => {
    const provider = capture(await load())
    targets([{ type: 'page', id: 'tab', title: 'Tab', url: 'https://tab', webSocketDebuggerUrl: 'ws://tab' }])

    socketMode = 'error'
    await expect(provider.inspect('tab', false)).rejects.toThrow('connection failed')
    expect(sockets.at(-1)?.closed).toBe(true)

    socketMode = 'manual'
    const controller = new AbortController()
    const socketCountBeforeAbort = sockets.length
    const aborted = provider.inspect('tab', false, controller.signal)
    await vi.waitFor(() => { expect(sockets).toHaveLength(socketCountBeforeAbort + 1) })
    controller.abort(new Error('stop'))
    await expect(aborted).rejects.toThrow('stop')
    expect(sockets.at(-1)?.closed).toBe(true)

    const listeners: Array<() => void> = []
    const legacySignal = {
      reason: undefined,
      throwIfAborted() {},
      addEventListener(_type: string, listener: () => void) { listeners.push(listener) },
      removeEventListener() {},
    } as unknown as AbortSignal
    const legacySocketCount = sockets.length
    const legacyAbort = provider.inspect('tab', false, legacySignal)
    await vi.waitFor(() => { expect(sockets).toHaveLength(legacySocketCount + 1) })
    listeners[0]?.()
    await expect(legacyAbort).rejects.toThrow('cancelled')

    socketMode = 'open'
    responseFor = () => ({ skip: true })
    const activeController = new AbortController()
    const active = provider.inspect('tab', true, activeController.signal)
    await vi.waitFor(() => { expect(sockets.at(-1)?.sent.length).toBe(1) })
    activeController.abort(new Error('active stop'))
    await expect(active).rejects.toThrow('active stop')
    expect(sockets.at(-1)?.closed).toBe(true)

    responseFor = () => ({ error: { message: 'protocol failure' } })
    await expect(provider.inspect('tab', false)).rejects.toThrow('protocol failure')

    responseFor = () => ({ skip: true })
    const socketCount = sockets.length
    const closed = provider.inspect('tab', false)
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(socketCount + 1)
      expect(sockets.at(-1)?.sent.length).toBe(1)
    })
    sockets.at(-1)?.emit('message', { data: '{}' })
    sockets.at(-1)?.emit('message', { data: '{"id":999,"result":{}}' })
    sockets.at(-1)?.close()
    await expect(closed).rejects.toThrow('connection closed')

    const errorSocketCount = sockets.length
    const errored = provider.inspect('tab', false)
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(errorSocketCount + 1)
      expect(sockets.at(-1)?.sent.length).toBe(1)
    })
    sockets.at(-1)?.emit('error')
    await expect(errored).rejects.toThrow('connection failed')
  })
})
