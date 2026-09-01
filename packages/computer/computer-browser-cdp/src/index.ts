/** Local Chromium DevTools Protocol Provider. @module @deepseek-ai/dsh-computer-browser-cdp */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer'
import { computerError } from '@deepseek-ai/dsh-computer'
import type { ComputerAction, ComputerElement, ComputerObservation, ComputerObservationMode, ComputerProvider, ComputerTarget } from '@deepseek-ai/dsh-computer'

const endpoint = process.env.DSH_BROWSER_CDP_URL
export const name = 'computer-browser-cdp'
export const inject = ['computer']

interface Target { readonly id: string; readonly title: string; readonly url: string; readonly type: string; readonly webSocketDebuggerUrl?: string }
interface ConnectedTarget extends Target { readonly webSocketDebuggerUrl: string }
interface CdpResponse { readonly id?: number; readonly result?: Record<string, unknown>; readonly error?: { readonly message: string } }
interface CdpConnection { send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>; close(): void }

function browserEndpoint(): string {
  if (endpoint === undefined || endpoint === '') throw computerError('ACTION_UNSUPPORTED', 'Browser automation requires DSH_BROWSER_CDP_URL.')
  return endpoint.replace(/\/$/, '')
}
async function targets(signal?: AbortSignal): Promise<readonly Target[]> {
  const response = await fetch(`${browserEndpoint()}/json/list`, signal === undefined ? {} : { signal })
  if (!response.ok) throw computerError('TARGET_NOT_FOUND', `Browser DevTools returned ${response.status}.`)
  const value: unknown = await response.json()
  if (!Array.isArray(value)) throw computerError('TARGET_NOT_FOUND', 'Browser DevTools returned an invalid target list.')
  return value.filter((target): target is Target => typeof target === 'object' && target !== null && (target as Target).type === 'page'
    && typeof (target as Target).id === 'string' && typeof (target as Target).title === 'string' && typeof (target as Target).url === 'string')
}
function targetName(target: Target): string { return target.title === '' ? target.url : target.title }
function computerTarget(target: Target): ComputerTarget { return { kind: 'browser-tab', id: target.id, name: targetName(target), url: target.url } }
async function selectedTarget(target: ComputerTarget, signal?: AbortSignal): Promise<ConnectedTarget> {
  if (target.kind !== 'browser-tab') throw computerError('ACTION_UNSUPPORTED', 'CDP only supports browser-tab targets.')
  const value = (await targets(signal)).find(item => item.id === target.id)
  if (value === undefined || value.webSocketDebuggerUrl === undefined) throw computerError('TARGET_NOT_FOUND', `Browser tab "${target.id}" is no longer available.`)
  return value as ConnectedTarget
}
async function connect(target: ConnectedTarget, signal?: AbortSignal): Promise<CdpConnection> {
  signal?.throwIfAborted()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let abortHandshake: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      abortHandshake = () => reject(signal?.reason instanceof Error ? signal.reason : new Error('Browser inspection cancelled.'))
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('Browser DevTools connection failed.')), { once: true })
      signal?.addEventListener('abort', abortHandshake, { once: true })
    })
  } catch (error) {
    socket.close()
    throw error
  } finally { if (abortHandshake !== undefined) signal?.removeEventListener('abort', abortHandshake) }
  let nextId = 1
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(reason: Error): void }>()
  const fail = (error: Error) => { for (const call of pending.values()) call.reject(error); pending.clear() }
  const abort = () => { fail(signal?.reason instanceof Error ? signal.reason : new Error('Browser inspection cancelled.')); socket.close() }
  signal?.addEventListener('abort', abort, { once: true })
  socket.addEventListener('error', () => fail(new Error('Browser DevTools connection failed.')))
  socket.addEventListener('close', () => fail(new Error('Browser DevTools connection closed.')))
  socket.addEventListener('message', event => {
    const response = JSON.parse(String(event.data)) as CdpResponse
    if (response.id === undefined) return
    const call = pending.get(response.id)
    if (call === undefined) return
    pending.delete(response.id)
    if (response.error !== undefined) call.reject(new Error(`Browser DevTools: ${response.error.message}`))
    else call.resolve(response.result ?? {})
  })
  return {
    send(method, params = {}) {
      signal?.throwIfAborted()
      const id = nextId++
      return new Promise<Record<string, unknown>>((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
    },
    close() { signal?.removeEventListener('abort', abort); fail(new Error('Browser DevTools connection closed.')); socket.close() },
  }
}
async function evaluate(connection: CdpConnection, expression: string): Promise<unknown> {
  const response = await connection.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails !== undefined) throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`)
  const result = response.result as { value?: unknown; description?: string } | undefined
  return result?.value ?? result?.description
}
function elementExpression(observationId: string): string {
  return `Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')).slice(0,240).map((element,index)=>{const r=element.getBoundingClientRect();return {id:${JSON.stringify(observationId)}+':'+index,role:element.getAttribute('role')||element.tagName.toLowerCase(),label:element.getAttribute('aria-label')||element.innerText||element.placeholder||'',value:'value'in element?String(element.value||''):'',enabled:!element.disabled,focused:document.activeElement===element,bounds:{x:r.x,y:r.y,width:r.width,height:r.height},actions:['click','set_value','type_text','paste','scroll','secondary_action']}})`
}
function elementIndex(elementId: string): number {
  const match = /(?:^|:)(\d+)$/.exec(elementId)
  if (match === null) throw computerError('ELEMENT_EXPIRED', 'Element id must come from the latest observation.')
  return Number(match[1])
}
const chosenElement = (index: number): string => `Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]'))[${index}]`
async function snapshot(target: Target, connection: CdpConnection, mode: ComputerObservationMode): Promise<ComputerObservation> {
  const id = randomUUID()
  const accessibility = mode === 'visual' ? undefined : await Promise.all([
    evaluate(connection, 'document.body.innerText'), evaluate(connection, elementExpression(id)),
  ]).then(([text, elements]) => ({ text: typeof text === 'string' ? text.slice(0, 20000) : '', elements: Array.isArray(elements) ? elements as ComputerElement[] : [], partial: Array.isArray(elements) && elements.length >= 240 }))
  let visual: ComputerObservation['visual']
  if (mode !== 'accessibility') {
    try {
      const screenshot = await connection.send('Page.captureScreenshot', { format: 'png' })
      const encoded = screenshot.data
      if (typeof encoded !== 'string') throw new Error('CDP returned no screenshot data.')
      visual = { image: { data: Uint8Array.from(Buffer.from(encoded, 'base64')), mediaType: 'image/png', name: 'browser-tab.png' }, scope: 'browser-tab' }
    } catch (error) { throw computerError('CAPTURE_FAILED', 'Browser tab capture failed.', error) }
  }
  return { id, target: computerTarget(target), title: target.title, ...(accessibility === undefined ? {} : { accessibility }), ...(visual === undefined ? {} : { visual }) }
}
function modifiers(values: readonly string[]): number { return values.reduce((sum, value) => sum | (value === 'alt' ? 1 : value === 'control' ? 2 : value === 'meta' ? 4 : 8), 0) }
async function performAction(connection: CdpConnection, action: ComputerAction): Promise<void> {
  if (action.kind === 'drag') {
    await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: action.from.x, y: action.from.y, button: 'left', clickCount: 1 })
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.to.x, y: action.to.y, button: 'left' })
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.to.x, y: action.to.y, button: 'left', clickCount: 1 })
    return
  }
  if (action.kind === 'key') { await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: action.key, modifiers: modifiers(action.modifiers) }); await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: action.key, modifiers: modifiers(action.modifiers) }); return }
  if (action.kind === 'click' && action.point !== undefined) {
    await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: action.point.x, y: action.point.y, button: action.button, clickCount: action.count })
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.point.x, y: action.point.y, button: action.button, clickCount: action.count })
    return
  }
  if (action.kind === 'scroll' && action.elementId === undefined) {
    const dx = action.direction === 'left' ? -action.amount : action.direction === 'right' ? action.amount : 0
    const dy = action.direction === 'up' ? -action.amount : action.direction === 'down' ? action.amount : 0
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: action.point?.x ?? 0, y: action.point?.y ?? 0, deltaX: dx, deltaY: dy })
    return
  }
  const id = 'elementId' in action ? action.elementId : undefined
  if (id === undefined) throw computerError('ACTION_UNSUPPORTED', `${action.kind} needs an element id or coordinates.`)
  const selected = chosenElement(elementIndex(id))
  const head = `(()=>{const element=${selected};if(!element)throw new Error('Element expired');element.scrollIntoView({block:'center'});`
  if (action.kind === 'click') {
    const body = action.button === 'right' ? `element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2}))` : `for(let i=0;i<${action.count};i++)element.click()`
    await evaluate(connection, `${head}${body}})()`); return
  }
  if (action.kind === 'set_value') {
    await evaluate(connection, `${head}element.focus();const text=${JSON.stringify(action.value)};if(element.isContentEditable)element.textContent=text;else if('value'in element)element.value=text;else throw new Error('Action unsupported');element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))})()`); return
  }
  if (action.kind === 'type_text' || action.kind === 'paste') {
    await evaluate(connection, `${head}if(!(element.isContentEditable||'value'in element))throw new Error('Action unsupported');element.focus()})()`)
    await connection.send('Input.insertText', { text: action.text })
    return
  }
  if (action.kind === 'scroll') {
    const dx = action.direction === 'left' ? -action.amount : action.direction === 'right' ? action.amount : 0
    const dy = action.direction === 'up' ? -action.amount : action.direction === 'down' ? action.amount : 0
    await evaluate(connection, `${head}(element.scrollHeight>element.clientHeight||element.scrollWidth>element.clientWidth?element:window).scrollBy({left:${dx},top:${dy},behavior:'instant'})})()`); return
  }
  if (action.kind === 'secondary_action') { await evaluate(connection, `${head}element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2}))})()`); return }
  throw computerError('ACTION_UNSUPPORTED', `Unsupported browser action ${(action as { kind: string }).kind}.`)
}

export function apply(ctx: Context): void {
  const provider: ComputerProvider = {
    id: 'browser-cdp', targetKinds: ['browser-tab'], available: () => endpoint !== undefined && endpoint !== '',
    async listTargets(signal) { return (await targets(signal)).map(computerTarget) },
    async observe(target, mode, signal) {
      const selected = await selectedTarget(target, signal); const connection = await connect(selected, signal)
      try { return await snapshot(selected, connection, mode) } finally { connection.close() }
    },
    async perform(target, action, signal) {
      const selected = await selectedTarget(target, signal); const connection = await connect(selected, signal)
      try { await performAction(connection, action); return await snapshot(selected, connection, action.kind === 'drag' || (action.kind === 'click' && action.point !== undefined) ? 'visual' : 'accessibility') }
      catch (error) {
        if (error instanceof Error && /Element expired/i.test(error.message)) throw computerError('ELEMENT_EXPIRED', 'Browser element is no longer current.', error)
        if (error instanceof Error && /Action unsupported/i.test(error.message)) throw computerError('ACTION_UNSUPPORTED', 'Browser element does not support this action.', error)
        throw error
      } finally { connection.close() }
    },
  }
  ctx.computer.register(provider)
}
