import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopRendererFrame, DesktopSessionSummary } from './shared.ts'
import './renderer.css'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function App(): React.JSX.Element {
  const [runtimeStatus, setRuntimeStatus] = useState<'starting' | 'ready' | 'stopped' | 'failed'>('starting')
  const [runtimeMessage, setRuntimeMessage] = useState('Connecting to standalone ACP Runtime…')
  const [workspace, setWorkspace] = useState('')
  const [sessions, setSessions] = useState<DesktopSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [prompt, setPrompt] = useState('Reply with a short greeting.')
  const [events, setEvents] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const appendEvent = useCallback((text: string): void => {
    setEvents(current => [...current.slice(-119), text])
  }, [])

  const refreshSessions = useCallback(async (): Promise<void> => {
    const listed = await window.dshDesktop.listSessions()
    setSessions(listed)
    setSelectedSessionId((current) => {
      if (current.length > 0 && listed.some(session => session.sessionId === current)) return current
      return listed[0]?.sessionId ?? ''
    })
  }, [])

  useEffect(() => window.dshDesktop.subscribe((frame: DesktopRendererFrame) => {
    if (frame.type === 'runtime-status') {
      setRuntimeStatus(frame.status)
      if (frame.message !== undefined) setRuntimeMessage(frame.message)
      else if (frame.status === 'ready') setRuntimeMessage('ACP Runtime ready')
      else if (frame.status === 'starting') setRuntimeMessage('Starting standalone ACP Runtime…')
      else if (frame.status === 'stopped') setRuntimeMessage('ACP Runtime stopped')
      return
    }
    // Replay and live presentation use the same ACP Session update path. Keep
    // the event log scoped to the active UI Session once one has been chosen.
    if (activeSessionId === undefined || frame.sessionId === activeSessionId) {
      appendEvent(frame.text)
    }
  }), [activeSessionId, appendEvent])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const cwd = await window.dshDesktop.workspace()
        if (controller.signal.aborted) return
        setWorkspace(cwd)
        await refreshSessions()
      } catch (error: unknown) {
        if (!controller.signal.aborted) appendEvent(`ERROR ${errorText(error)}`)
      }
    })()
    return () => { controller.abort() }
  }, [appendEvent, refreshSessions])

  const createSession = async (): Promise<void> => {
    setBusy(true)
    try {
      if (activeSessionId !== undefined) await window.dshDesktop.closeSession(activeSessionId)
      const sessionId = await window.dshDesktop.createSession()
      setActiveSessionId(sessionId)
      setSelectedSessionId(sessionId)
      setEvents([`[session ${sessionId}]`])
      await refreshSessions()
    } catch (error: unknown) {
      appendEvent(`ERROR ${errorText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const loadSession = async (): Promise<void> => {
    if (selectedSessionId.length === 0) return
    setBusy(true)
    try {
      if (activeSessionId !== undefined && activeSessionId !== selectedSessionId) {
        await window.dshDesktop.closeSession(activeSessionId)
      }
      setEvents([])
      await window.dshDesktop.loadSession(selectedSessionId)
      setActiveSessionId(selectedSessionId)
      appendEvent(`[session ${selectedSessionId}]`)
    } catch (error: unknown) {
      appendEvent(`ERROR ${errorText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const closeSession = async (): Promise<void> => {
    const sessionId = activeSessionId
    if (sessionId === undefined) return
    setBusy(true)
    try {
      await window.dshDesktop.closeSession(sessionId)
      setActiveSessionId(undefined)
      appendEvent(`[closed ${sessionId}; durable history retained]`)
      await refreshSessions()
    } catch (error: unknown) {
      appendEvent(`ERROR ${errorText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const sendPrompt = async (): Promise<void> => {
    const text = prompt.trim()
    if (text.length === 0) return
    setBusy(true)
    try {
      let sessionId = activeSessionId
      if (sessionId === undefined) {
        sessionId = await window.dshDesktop.createSession()
        setActiveSessionId(sessionId)
        setSelectedSessionId(sessionId)
        appendEvent(`[session ${sessionId}]`)
      }
      const result = await window.dshDesktop.prompt(sessionId, text)
      appendEvent(`[stop ${result.stopReason}]`)
      await refreshSessions()
    } catch (error: unknown) {
      appendEvent(`ERROR ${errorText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const restartRuntime = async (): Promise<void> => {
    setBusy(true)
    try {
      setActiveSessionId(undefined)
      await window.dshDesktop.restartRuntime()
      await refreshSessions()
    } catch (error: unknown) {
      appendEvent(`ERROR ${errorText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return <main>
    <header>
      <div>
        <p className="eyebrow">ACP product client</p>
        <h1>DeepSeek Harness Desktop</h1>
      </div>
      <span className={`status ${runtimeStatus}`}>{runtimeStatus}</span>
    </header>

    <section className="host">
      <span>Standalone Runtime</span>
      <code>{runtimeMessage}</code>
      {runtimeStatus === 'failed'
        ? <button disabled={busy} onClick={() => { void restartRuntime() }}>Restart Runtime</button>
        : <code className="workspace" title={workspace}>{workspace || 'Resolving workspace…'}</code>}
    </section>

    <section className="sessions">
      <div className="sessionPicker">
        <label htmlFor="session-select">Durable sessions</label>
        <select
          id="session-select"
          value={selectedSessionId}
          disabled={busy || sessions.length === 0}
          onChange={(event) => { setSelectedSessionId(event.target.value) }}
        >
          {sessions.length === 0 && <option value="">No sessions yet</option>}
          {sessions.map(session => <option key={session.sessionId} value={session.sessionId}>
            {session.title === undefined ? session.sessionId : `${session.title} · ${session.sessionId}`}
          </option>)}
        </select>
      </div>
      <div className="sessionActions">
        <button className="secondary" disabled={busy} onClick={() => { void refreshSessions() }}>Refresh</button>
        <button className="secondary" disabled={busy || selectedSessionId.length === 0} onClick={() => { void loadSession() }}>Load</button>
        <button disabled={busy || runtimeStatus === 'failed'} onClick={() => { void createSession() }}>New Session</button>
        <button className="secondary" disabled={busy || activeSessionId === undefined} onClick={() => { void closeSession() }}>Close Live Session</button>
      </div>
    </section>

    <section className="composer">
      <div className="activeSession">
        <span>Active Session</span>
        <code>{activeSessionId ?? 'none — sending will create one'}</code>
      </div>
      <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value) }} aria-label="Prompt" />
      <div className="actions">
        <button disabled={busy || runtimeStatus === 'failed' || prompt.trim().length === 0} onClick={() => { void sendPrompt() }}>
          {busy ? 'Working…' : 'Send via ACP'}
        </button>
        <button
          className="secondary"
          disabled={activeSessionId === undefined}
          onClick={() => { if (activeSessionId !== undefined) window.dshDesktop.cancel(activeSessionId) }}
        >Cancel turn</button>
      </div>
    </section>

    <section className="events">
      <div className="eventsTitle"><strong>ACP presentation stream</strong><span>{events.length} updates</span></div>
      <pre>{events.length === 0 ? 'Load or prompt a Session to receive replay/live updates…' : events.join('\n')}</pre>
    </section>
  </main>
}

const root = document.getElementById('root')
if (root === null) throw new Error('desktop renderer: missing #root')
createRoot(root).render(<App />)
