/** Local Chromium DevTools Protocol Provider. @module @deepseek-ai/dsh-computer-browser-cdp */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer'
import type { ComputerAction, ComputerElement, ComputerProvider, ComputerSnapshot } from '@deepseek-ai/dsh-computer'

const endpoint = process.env.DSH_BROWSER_CDP_URL
export const name = 'computer-browser-cdp'
export const inject = ['computer']

interface Target {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly type: string
  readonly webSocketDebuggerUrl?: string
}
interface ConnectedTarget extends Target { readonly webSocketDebuggerUrl: string }
interface CdpResponse {
  readonly id?: number
  readonly result?: Record<string, unknown>
  readonly error?: { readonly message: string }
}
interface CdpConnection {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  close(): void
}

function browserEndpoint(): string {
  if (endpoint === undefined || endpoint === '') throw new Error('Browser automation requires DSH_BROWSER_CDP_URL, for example http://127.0.0.1:9222.')
  return endpoint.replace(/\/$/, '')
}

async function targets(signal?: AbortSignal): Promise<readonly Target[]> {
  const response = await fetch(`${browserEndpoint()}/json/list`, signal === undefined ? {} : { signal })
  if (!response.ok) throw new Error(`Browser automation could not reach DevTools (${response.status}).`)
  const value: unknown = await response.json()
  if (!Array.isArray(value)) throw new Error('Browser DevTools returned an invalid target list.')
  return value.filter((target): target is Target => typeof target === 'object'
    && target !== null
    && (target as Target).type === 'page'
    && typeof (target as Target).id === 'string'
    && typeof (target as Target).title === 'string'
    && typeof (target as Target).url === 'string')
}

function targetName(target: Target): string { return target.title === '' ? target.url : target.title }
async function selectedTarget(id: string, signal?: AbortSignal): Promise<ConnectedTarget> {
  const target = (await targets(signal)).find(item => item.id === id)
  if (target === undefined || target.webSocketDebuggerUrl === undefined) throw new Error(`Browser tab "${id}" is no longer available.`)
  return target as ConnectedTarget
}

async function connect(target: ConnectedTarget, signal?: AbortSignal): Promise<CdpConnection> {
  signal?.throwIfAborted()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let onAbort: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => {
        const reason: unknown = signal?.reason
        reject(reason instanceof Error ? reason : new Error('Browser inspection was cancelled.'))
      }
      socket.addEventListener('open', () => { resolve() }, { once: true })
      socket.addEventListener('error', () => { reject(new Error('Browser DevTools connection failed.')) }, { once: true })
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    signal?.throwIfAborted()
  } catch (error: unknown) {
    socket.close()
    throw error
  } finally {
    /* v8 ignore next -- the Promise executor assigns onAbort synchronously before the awaited handshake can settle. */
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
  let nextId = 1
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(reason: Error): void }>()
  const failPending = (reason: Error): void => {
    for (const call of pending.values()) call.reject(reason)
    pending.clear()
  }
  socket.addEventListener('close', () => { failPending(new Error('Browser DevTools connection closed.')) })
  socket.addEventListener('error', () => { failPending(new Error('Browser DevTools connection failed.')) })
  socket.addEventListener('message', (event) => {
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
      const id = nextId++
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { failPending(new Error('Browser DevTools connection closed.')); socket.close() },
  }
}

const elementExpression = [
  'Array.from(document.querySelectorAll(\'a,button,input,textarea,select,[role="button"],[contenteditable="true"]\'))',
  '.slice(0,80).map((element,index)=>({id:String(index),role:element.getAttribute(\'role\')||element.tagName.toLowerCase(),',
  'label:element.getAttribute(\'aria-label\')||element.innerText||element.value||element.placeholder||\'\',enabled:!element.disabled}))',
].join('')
function evaluation(result: Record<string, unknown>): unknown {
  const value = result.result as { value?: unknown; description?: string } | undefined
  return value?.value ?? value?.description
}
async function evaluate(connection: CdpConnection, expression: string): Promise<unknown> {
  return evaluation(await connection.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
}
async function snapshot(target: Target, connection: CdpConnection, includeScreenshot: boolean): Promise<ComputerSnapshot> {
  const text = await evaluate(connection, 'document.body.innerText')
  const value = await evaluate(connection, elementExpression)
  const elements = Array.isArray(value) ? value as ComputerElement[] : []
  const screenshot = includeScreenshot ? await connection.send('Page.captureScreenshot', { format: 'png' }) : undefined
  const encoded = screenshot?.data
  return {
    app: { id: target.id, name: targetName(target) }, title: target.title, text: typeof text === 'string' ? text : '', elements,
    ...(typeof encoded === 'string' ? { screenshot: { data: Uint8Array.from(Buffer.from(encoded, 'base64')), mediaType: 'image/png', name: 'browser-snapshot.png' } } : {}),
  }
}
function element(action: ComputerAction): number {
  if ('elementId' in action && /^\d+$/.test(action.elementId)) return Number(action.elementId)
  throw new Error('Browser action needs an element id from the latest inspect result.')
}
const chosenElement = (index: number): string => `Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'))[${index}]`
async function act(_target: Target, connection: CdpConnection, action: ComputerAction): Promise<void> {
  const selected = 'element'
  if (action.kind === 'click') await evaluate(connection, [
    `(()=>{const ${selected}=${chosenElement(element(action))};if(!${selected})throw new Error('Element expired');`,
    `${selected}.scrollIntoView({block:'center'});${selected}.click()})()`,
  ].join(''))
  else if (action.kind === 'type') await evaluate(connection, [
    `(()=>{const ${selected}=${chosenElement(element(action))};if(!${selected})throw new Error('Element expired');${selected}.focus();`,
    `const text=${JSON.stringify(action.text)};if(${selected}.isContentEditable)${selected}.textContent=text;else ${selected}.value=text;`,
    `${selected}.dispatchEvent(new Event('input',{bubbles:true}));${selected}.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  ].join(''))
  else if (action.kind === 'key') await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: action.key })
  else await evaluate(connection, [
    `(()=>{const ${selected}=${chosenElement(element(action))};(${selected}||window).scrollBy({`,
    `top:${action.direction === 'up' ? '-600' : '600'},behavior:'instant'})})()`,
  ].join(''))
}

/** Register browser automation when a Chromium instance exposes its local DevTools endpoint. */
export function apply(ctx: Context): void {
  const provider: ComputerProvider = {
    id: 'browser-cdp', available: () => endpoint !== undefined && endpoint !== '',
    async listApps(signal) {
      return (await targets(signal)).map(target => ({ id: target.id, name: targetName(target) }))
    },
    async inspect(app, includeScreenshot, signal) {
      const target = await selectedTarget(app, signal)
      const connection = await connect(target, signal)
      try { return await snapshot(target, connection, includeScreenshot) }
      finally { connection.close() }
    },
    async act(app, action, signal) {
      const target = await selectedTarget(app, signal)
      const connection = await connect(target, signal)
      try { await act(target, connection, action); return await snapshot(target, connection, false) }
      finally { connection.close() }
    },
  }
  ctx.computer.register(provider)
}
