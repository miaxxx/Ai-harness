import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerAction, ComputerProvider } from '@deepseek-ai/dsh-computer'

type Listener = (event: { data?: string }) => void
type ResponsePlan = { result?: Record<string, unknown>; error?: { message: string }; skip?: boolean }
const sockets: FakeSocket[] = []
let responseFor: (request: { id: number; method: string; params: Record<string, unknown> }) => ResponsePlan = () => ({ result: {} })

class FakeSocket {
  readonly sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = []
  readonly listeners = new Map<string, Array<{ listener: Listener; once: boolean }>>()
  closed = false
  constructor(readonly url: string) { sockets.push(this); queueMicrotask(() => this.emit('open')) }
  addEventListener(type: string, listener: Listener, options?: { once?: boolean }): void {
    const entries = this.listeners.get(type) ?? []; entries.push({ listener, once: options?.once === true }); this.listeners.set(type, entries)
  }
  removeEventListener(type: string, listener: Listener): void { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry.listener !== listener)) }
  emit(type: string, event: { data?: string } = {}): void {
    const entries = [...(this.listeners.get(type) ?? [])]; this.listeners.set(type, entries.filter(entry => !entry.once)); for (const entry of entries) entry.listener(event)
  }
  send(text: string): void {
    const request = JSON.parse(text) as { id: number; method: string; params: Record<string, unknown> }; this.sent.push(request)
    const plan = responseFor(request); if (plan.skip === true) return
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: request.id, ...(plan.result === undefined ? {} : { result: plan.result }), ...(plan.error === undefined ? {} : { error: plan.error }) }) }))
  }
  close(): void { if (this.closed) return; this.closed = true; this.emit('close') }
}
function capture(module: { apply(ctx: unknown): void }): ComputerProvider {
  let provider: ComputerProvider | undefined
  module.apply({ computer: { register(value: ComputerProvider) { provider = value } } })
  if (provider === undefined) throw new Error('provider was not registered')
  return provider
}
async function load(endpoint = 'http://127.0.0.1:9222/') { vi.resetModules(); vi.stubEnv('DSH_BROWSER_CDP_URL', endpoint); return await import('@deepseek-ai/dsh-computer-browser-cdp') }
function targets(value: unknown, ok = true, status = 200): void { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(value) })) }
const tab = { kind: 'browser-tab' as const, id: 'tab', name: 'Tab' }
function targetRecord() { return { type: 'page', id: 'tab', title: 'Tab', url: 'https://tab', webSocketDebuggerUrl: 'ws://tab' } }
function accessibleResponses(request: { method: string; params: Record<string, unknown> }): ResponsePlan {
  if (request.method === 'Page.captureScreenshot') return { result: { data: Buffer.from([1, 2]).toString('base64') } }
  if (request.method !== 'Runtime.evaluate') return { result: {} }
  const expression = String(request.params.expression)
  if (expression === 'document.body.innerText') return { result: { result: { value: 'Page text' } } }
  if (expression.includes('slice(0,240)')) return { result: { result: { value: [{ id: 'obs:0', role: 'button', label: 'Go', value: '', enabled: true, focused: false, actions: ['click'] }] } } }
  return { result: { result: { value: true } } }
}
beforeEach(() => { sockets.splice(0); responseFor = accessibleResponses; vi.stubGlobal('WebSocket', FakeSocket) })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Chromium CDP computer Provider', () => {
  it('declares browser-tab support and validates discovery', async () => {
    const unavailable = capture(await load(''))
    expect(unavailable.targetKinds).toEqual(['browser-tab'])
    expect(unavailable.available()).toBe(false)
    await expect(unavailable.listTargets()).rejects.toThrow('DSH_BROWSER_CDP_URL')

    const provider = capture(await load())
    targets([], false, 503)
    await expect(provider.listTargets()).rejects.toThrow('TARGET_NOT_FOUND')
    targets({})
    await expect(provider.listTargets()).rejects.toThrow('invalid target list')
    targets([{ type: 'worker', id: 'worker', title: 'Worker', url: 'worker:' }, targetRecord()])
    await expect(provider.listTargets()).resolves.toEqual([{ kind: 'browser-tab', id: 'tab', name: 'Tab', url: 'https://tab' }])
  })

  it('observes semantic state and browser-tab-scoped pixels', async () => {
    const provider = capture(await load()); targets([targetRecord()])
    const semantic = await provider.observe(tab, 'accessibility')
    expect(semantic).toMatchObject({ target: { kind: 'browser-tab', id: 'tab' }, title: 'Tab', accessibility: { text: 'Page text', elements: [{ label: 'Go' }] } })
    const elementId = semantic.accessibility?.elements[0]?.id
    expect(elementId).toMatch(/^[0-9a-f-]+:0$/)
    const visual = await provider.observe(tab, 'both')
    expect(visual.visual).toMatchObject({ scope: 'browser-tab', image: { mediaType: 'image/png', name: 'browser-tab.png' } })
    expect(sockets.every(socket => socket.closed)).toBe(true)
  })

  it('rejects missing targets and malformed stale element ids', async () => {
    const provider = capture(await load()); targets([])
    await expect(provider.observe(tab, 'accessibility')).rejects.toThrow('TARGET_NOT_FOUND')
    targets([targetRecord()])
    await expect(provider.perform(tab, { kind: 'click', elementId: 'bad', button: 'left', count: 1 })).rejects.toThrow('ELEMENT_EXPIRED')
  })

  it('supports semantic actions, coordinate actions, four-way scrolling, and fresh post-action state', async () => {
    const provider = capture(await load()); targets([targetRecord()])
    const actions: ComputerAction[] = [
      { kind: 'click', elementId: 'latest:0', button: 'left', count: 2 },
      { kind: 'click', point: { x: 10, y: 20 }, button: 'right', count: 1 },
      { kind: 'drag', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
      { kind: 'set_value', elementId: 'latest:0', value: 'value' },
      { kind: 'type_text', elementId: 'latest:0', text: 'typed' },
      { kind: 'paste', elementId: 'latest:0', text: 'pasted' },
      { kind: 'key', key: 'Enter', modifiers: ['meta'] },
      { kind: 'scroll', elementId: 'latest:0', direction: 'left', amount: 200 },
      { kind: 'scroll', point: { x: 4, y: 5 }, direction: 'right', amount: 200 },
      { kind: 'secondary_action', elementId: 'latest:0' },
    ]
    for (const action of actions) await expect(provider.perform(tab, action)).resolves.toHaveProperty('id')
    const calls = sockets.flatMap(socket => socket.sent)
    expect(calls.some(call => call.method === 'Input.dispatchMouseEvent' && call.params.type === 'mousePressed')).toBe(true)
    expect(calls.some(call => call.method === 'Input.dispatchMouseEvent' && call.params.type === 'mouseWheel')).toBe(true)
    expect(calls.some(call => call.method === 'Input.dispatchKeyEvent')).toBe(true)
    expect(calls.filter(call => call.method === 'Input.insertText').map(call => call.params.text)).toEqual(['typed', 'pasted'])
    expect(calls.some(call => call.method === 'Runtime.evaluate' && String(call.params.expression).includes('contextmenu'))).toBe(true)
  })

  it('maps script-side element expiry and screenshot failures to stable codes', async () => {
    const provider = capture(await load()); targets([targetRecord()])
    responseFor = request => request.method === 'Runtime.evaluate' && String(request.params.expression).includes('const element=')
      ? { result: { exceptionDetails: { text: 'Element expired' } } }
      : accessibleResponses(request)
    await expect(provider.perform(tab, { kind: 'click', elementId: 'latest:0', button: 'left', count: 1 })).rejects.toThrow('ELEMENT_EXPIRED')
    responseFor = request => request.method === 'Page.captureScreenshot' ? { error: { message: 'capture failed' } } : accessibleResponses(request)
    await expect(provider.observe(tab, 'visual')).rejects.toThrow('CAPTURE_FAILED')
  })
})
