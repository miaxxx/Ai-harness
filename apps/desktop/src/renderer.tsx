import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ResponseValue } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { DesktopFetchResponse, DesktopRendererFrame } from './shared.ts'
import './renderer.css'

interface PendingBody {
  controller: ReadableStreamDefaultController<Uint8Array>
  disposeAbort(): void
}

type SessionId = ResponseValue<'session.create'>['sessionId']

class DesktopApiClient extends AbstractApiClient {
  private readonly pending = new Map<string, PendingBody>()

  constructor() {
    super()
    window.dshDesktop.subscribe((frame) => { this.receive(frame) })
  }

  protected async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    if (init?.signal?.aborted === true) {
      throw init.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
    }
    const id = crypto.randomUUID()
    const body = init?.body
    if (body !== undefined && body !== null && typeof body !== 'string') {
      throw new Error('desktop transport accepts UTF-8 string request bodies only')
    }
    let bodyController!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller },
      cancel: () => { window.dshDesktop.cancel(id) },
    })
    const abort = (): void => { window.dshDesktop.cancel(id) }
    const signal = init?.signal
    signal?.addEventListener('abort', abort, { once: true })
    const disposeAbort = (): void => { signal?.removeEventListener('abort', abort) }
    this.pending.set(id, { controller: bodyController, disposeAbort })
    try {
      const response: DesktopFetchResponse = await window.dshDesktop.start({
        type: 'request', id, path: `${input.pathname}${input.search}`,
        method: init?.method ?? 'GET', headers: [...new Headers(init?.headers).entries()],
        ...(body === undefined || body === null ? {} : { body }),
      })
      window.dshDesktop.resume(id)
      return new Response(stream, response)
    } catch (error) {
      this.pending.delete(id)
      disposeAbort()
      bodyController.error(error)
      throw error
    }
  }

  private receive(frame: DesktopRendererFrame): void {
    if (frame.type === 'host-status') return
    if (frame.id === undefined) return
    const body = this.pending.get(frame.id)
    if (body === undefined) return
    if (frame.type === 'data') {
      const raw = atob(frame.chunk)
      body.controller.enqueue(Uint8Array.from(raw, character => character.charCodeAt(0)))
      return
    }
    this.pending.delete(frame.id)
    body.disposeAbort()
    if (frame.type === 'end') body.controller.close()
    else body.controller.error(new Error(frame.message))
  }
}

function App(): React.JSX.Element {
  const api = useMemo(() => new DesktopApiClient(), [])
  const [hostStatus, setHostStatus] = useState('starting')
  const [host, setHost] = useState('Waiting for Agent Host…')
  const [prompt, setPrompt] = useState('Reply with a short greeting, then run pwd.')
  const [sessionId, setSessionId] = useState<SessionId>()
  const [events, setEvents] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => window.dshDesktop.subscribe((frame) => {
    if (frame.type !== 'host-status') return
    setHostStatus(frame.status)
    if (frame.message !== undefined) setHost(frame.message)
  }), [])

  useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      try {
        const description = await api.host.describe({}, abort.signal)
        setHost(description.result.ok
          ? `${description.result.value.version} · ${description.result.value.cwd}`
          : description.result.error.message)
        for await (const frame of api.events.mux({}, abort.signal)) {
          setEvents(current => [...current.slice(-79), JSON.stringify(frame.payload)])
        }
      } catch (error) {
        if (!abort.signal.aborted) setHost(String(error))
      }
    })()
    return () => { abort.abort() }
  }, [api])

  const sendPrompt = async (): Promise<void> => {
    setBusy(true)
    try {
      let target = sessionId
      if (target === undefined) {
        const created = await api.sessions.create({})
        if (!created.result.ok) throw new Error(created.result.error.message)
        target = created.result.value.sessionId
        setSessionId(target)
      }
      const accepted = await api.sessions.prompt({
        sessionId: target, mode: 'queue', content: [{ type: 'text', text: prompt }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (!accepted.result.ok) throw new Error(accepted.result.error.message)
    } catch (error) {
      setEvents(current => [...current, `ERROR ${String(error)}`])
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (sessionId === undefined) return
    const result = await api.sessions.cancel({ sessionId })
    const outcome = result.result
    if (!outcome.ok) setEvents(current => [...current, `ERROR ${outcome.error.message}`])
  }

  return <main>
    <header>
      <div>
        <p className="eyebrow">macOS technical preview</p>
        <h1>DeepSeek Harness Desktop</h1>
      </div>
      <span className={`status ${hostStatus}`}>{hostStatus}</span>
    </header>
    <section className="host">
      <span>Independent Agent Host</span>
      <code>{host}</code>
      {hostStatus === 'failed' && <button onClick={() => { void window.dshDesktop.restartHost() }}>Restart Host</button>}
    </section>
    <section className="composer">
      <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value) }} aria-label="Prompt" />
      <div className="actions">
        <button disabled={busy || hostStatus === 'failed'} onClick={() => { void sendPrompt() }}>
          {busy ? 'Sending…' : 'Send to Agent'}
        </button>
        <button className="secondary" disabled={sessionId === undefined} onClick={() => { void cancel() }}>Cancel turn</button>
      </div>
    </section>
    <section className="events">
      <div className="eventsTitle"><strong>Live mux stream</strong><span>{events.length} frames</span></div>
      <pre>{events.length === 0 ? 'Waiting for session events…' : events.join('\n')}</pre>
    </section>
  </main>
}

const root = document.getElementById('root')
if (root === null) throw new Error('desktop renderer: missing #root')
createRoot(root).render(<App />)
