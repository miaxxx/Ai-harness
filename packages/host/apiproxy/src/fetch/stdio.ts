/**
 * Host half of the stdio Fetch carrier. It accepts versioned NDJSON frames,
 * invokes an injected WHATWG Fetch handler, and returns response metadata and
 * body chunks without interpreting the API envelope carried in the body.
 * @module @deepseek-ai/dsh-host-apiproxy/stdio
 */

import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import {
  parseStdioFetchClientFrame,
  STDIO_FETCH_PROTOCOL_VERSION,
  type StdioFetchRequestFrame,
  type StdioFetchServerFrame,
} from './stdio-protocol.ts'

/** Running stdio carrier returned by {@link serveStdioFetch}. */
export interface StdioFetchServer {
  /** Resolve after input closes, every accepted request settles, and no more frames can be written. */
  done: Promise<void>
  /** Stop accepting frames, abort active requests, and await quiescence. */
  close(): Promise<void>
}

/** Inputs for {@link serveStdioFetch}. */
export interface StdioFetchServerOptions {
  /** Fetch-shaped API handler, normally {@code toFetchHandler(ctx.apiProxy)}. */
  handler: { fetch: typeof fetch }
  /** Client-to-host NDJSON stream. */
  input: Readable
  /** Host-to-client NDJSON stream; no unrelated output may share it. */
  output: Writable
}

/**
 * Serve one versioned Fetch connection over newline-delimited JSON.
 * Requests may run concurrently. A cancel frame aborts only its matching
 * request; input EOF aborts all requests and resolves {@link StdioFetchServer.done}
 * after they settle.
 * @param options - Fetch handler and the dedicated input/output streams.
 * @returns The running server lifecycle.
 */
export function serveStdioFetch(options: StdioFetchServerOptions): StdioFetchServer {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity, terminal: false })
  const active = new Map<string, { controller: AbortController; task: Promise<void> }>()
  let handshaken = false
  let accepting = true
  let writeTail = Promise.resolve()

  const writeFrame = (frame: StdioFetchServerFrame): Promise<void> => {
    const body = `${JSON.stringify(frame)}\n`
    const write = async (): Promise<void> => {
      if (options.output.write(body)) return
      await once(options.output, 'drain')
    }
    const next = writeTail.then(write)
    writeTail = next.catch(() => {})
    return next
  }

  const fail = async (message: string, fatal: boolean, id?: string): Promise<void> => {
    const reported = writeFrame({ type: 'error', ...(id === undefined ? {} : { id }), message, fatal })
    if (fatal) {
      accepting = false
      lines.close()
      for (const request of active.values()) request.controller.abort()
    }
    await reported
  }

  const runRequest = async (frame: StdioFetchRequestFrame, controller: AbortController): Promise<void> => {
    if (!frame.path.startsWith('/api/')) {
      await fail('request.path must begin with /api/', false, frame.id)
      return
    }
    const init: RequestInit = {
      method: frame.method,
      headers: frame.headers,
      signal: controller.signal,
      ...(frame.body === undefined ? {} : { body: frame.body }),
    }
    try {
      const response = await options.handler.fetch(new URL(frame.path, 'http://dsh.internal'), init)
      await writeFrame({
        type: 'response',
        id: frame.id,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
      })
      if (response.body !== null) {
        const reader = response.body.getReader()
        try {
          while (true) {
            const item = await reader.read()
            if (item.done) break
            await writeFrame({ type: 'data', id: frame.id, chunk: Buffer.from(item.value).toString('base64') })
          }
        } finally {
          reader.releaseLock()
        }
      }
      await writeFrame({ type: 'end', id: frame.id })
    } catch (error: unknown) {
      const message = controller.signal.aborted ? 'request cancelled' : String(error)
      await fail(message, false, frame.id)
    }
  }

  const handleLine = async (line: string): Promise<void> => {
    /* v8 ignore next -- readline stops emitting lines synchronously when a fatal frame closes it;
     * this guards an already-dispatched callback. */
    if (!accepting) return
    if (line.trim() === '') return
    let frame
    try {
      frame = parseStdioFetchClientFrame(JSON.parse(line) as unknown)
    } catch (error: unknown) {
      await fail(`invalid frame: ${String(error)}`, false)
      return
    }
    if (frame.type === 'hello') {
      if (handshaken) {
        await fail('hello already received', true)
        return
      }
      if (frame.version !== STDIO_FETCH_PROTOCOL_VERSION) {
        await fail(
          `protocol version mismatch: host=${String(STDIO_FETCH_PROTOCOL_VERSION)} client=${String(frame.version)}`,
          true,
        )
        return
      }
      handshaken = true
      await writeFrame({ type: 'ready', version: STDIO_FETCH_PROTOCOL_VERSION })
      return
    }
    if (!handshaken) {
      await fail('hello must be the first frame', true)
      return
    }
    if (frame.type === 'cancel') {
      active.get(frame.id)?.controller.abort()
      return
    }
    if (active.has(frame.id)) {
      await fail(`request id ${JSON.stringify(frame.id)} is already active`, false, frame.id)
      return
    }
    const controller = new AbortController()
    const task = runRequest(frame, controller).finally(() => { active.delete(frame.id) })
    active.set(frame.id, { controller, task })
  }

  const handlers = new Set<Promise<void>>()
  lines.on('line', (line) => {
    const task = handleLine(line).catch(() => {})
    handlers.add(task)
    void task.finally(() => { handlers.delete(task) })
  })

  let finish!: () => void
  const inputClosed = new Promise<void>((resolve) => { finish = resolve })
  lines.once('close', finish)

  const close = async (): Promise<void> => {
    accepting = false
    lines.close()
    for (const request of active.values()) request.controller.abort()
    await inputClosed
    await Promise.allSettled([...handlers, ...[...active.values()].map(request => request.task)])
    await writeTail
  }

  return { done: inputClosed.then(close), close }
}
