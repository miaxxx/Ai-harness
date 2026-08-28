/** Stdio Fetch carriage: handshake, concurrent streams, cancellation, and fail-closed versioning. */

import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  parseStdioFetchClientFrame,
  parseStdioFetchServerFrame,
  serveStdioFetch,
  STDIO_FETCH_PROTOCOL_VERSION,
  type StdioFetchClientFrame,
  type StdioFetchServerFrame,
} from '../src/index.ts'

class FrameReader {
  private buffer = ''
  private readonly frames: StdioFetchServerFrame[] = []
  private readonly waiters: Array<(frame: StdioFetchServerFrame) => void> = []

  constructor(stream: PassThrough) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      this.buffer += chunk
      while (true) {
        const newline = this.buffer.indexOf('\n')
        if (newline === -1) return
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        const frame = JSON.parse(line) as StdioFetchServerFrame
        const waiter = this.waiters.shift()
        if (waiter === undefined) this.frames.push(frame)
        else waiter(frame)
      }
    })
  }

  next(): Promise<StdioFetchServerFrame> {
    const frame = this.frames.shift()
    return frame === undefined
      ? new Promise((resolve) => { this.waiters.push(resolve) })
      : Promise.resolve(frame)
  }
}

function send(stream: PassThrough, frame: StdioFetchClientFrame): void {
  stream.write(`${JSON.stringify(frame)}\n`)
}

async function connect(
  handler: { fetch: typeof fetch },
  output = new PassThrough(),
): Promise<{ input: PassThrough; output: PassThrough; reader: FrameReader; server: ReturnType<typeof serveStdioFetch> }> {
  const input = new PassThrough()
  const reader = new FrameReader(output)
  const server = serveStdioFetch({ handler, input, output })
  send(input, { type: 'hello', version: STDIO_FETCH_PROTOCOL_VERSION })
  await expect(reader.next()).resolves.toEqual({ type: 'ready', version: STDIO_FETCH_PROTOCOL_VERSION })
  return { input, output, reader, server }
}

describe('stdio fetch carrier', () => {
  it('parses every client and server frame variant', () => {
    const request = {
      type: 'request', id: 'request', path: '/api/host.describe', method: 'POST',
      headers: [['content-type', 'application/json']], body: '{}',
    } as const
    expect(parseStdioFetchClientFrame({ type: 'hello', version: 1 })).toEqual({ type: 'hello', version: 1 })
    expect(parseStdioFetchClientFrame(request)).toEqual(request)
    expect(parseStdioFetchClientFrame({ type: 'cancel', id: 'request' })).toEqual({ type: 'cancel', id: 'request' })

    const frames: StdioFetchServerFrame[] = [
      { type: 'ready', version: 1 },
      { type: 'response', id: 'request', status: 204, statusText: '', headers: [] },
      { type: 'data', id: 'request', chunk: 'YQ==' },
      { type: 'end', id: 'request' },
      { type: 'error', id: 'request', message: 'failed', fatal: false },
      { type: 'error', message: 'failed', fatal: true },
    ]
    for (const frame of frames) expect(parseStdioFetchServerFrame(frame)).toEqual(frame)
    expect(() => parseStdioFetchClientFrame({ type: 'request', id: '', headers: [] })).toThrow()
    expect(() => parseStdioFetchServerFrame({ type: 'response', status: 700 })).toThrow()
  })

  it('carries two concurrent response streams without interpreting their bodies', async () => {
    const encoder = new TextEncoder()
    const handler = {
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        const path = new URL(input instanceof Request ? input.url : input).pathname
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`${path}:one`))
            controller.enqueue(encoder.encode(`${path}:two`))
            controller.close()
          },
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      },
    }
    const { input, reader, server } = await connect(handler)
    send(input, { type: 'request', id: 'mux', path: '/api/events.mux', method: 'GET', headers: [] })
    send(input, { type: 'request', id: 'host', path: '/api/events.host', method: 'GET', headers: [] })

    const frames = await Promise.all(Array.from({ length: 8 }, async () => reader.next()))
    const byId = (id: string): StdioFetchServerFrame[] => frames.filter(frame => 'id' in frame && frame.id === id)
    for (const id of ['mux', 'host']) {
      expect(byId(id).map(frame => frame.type)).toEqual(['response', 'data', 'data', 'end'])
      const chunks = byId(id).filter((frame): frame is Extract<StdioFetchServerFrame, { type: 'data' }> => frame.type === 'data')
      expect(chunks.map(frame => Buffer.from(frame.chunk, 'base64').toString('utf8')))
        .toEqual([`/api/events.${id}:one`, `/api/events.${id}:two`])
    }

    input.end()
    await server.done
  })

  it('aborts only the matching request and reports cancellation', async () => {
    let observedAbort = false
    const handler = {
      fetch: (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            observedAbort = true
            reject(new Error('aborted by test'))
          }, { once: true })
        }),
    }
    const { input, reader, server } = await connect(handler)
    send(input, { type: 'request', id: 'slow', path: '/api/session.search', method: 'POST', headers: [] })
    send(input, { type: 'cancel', id: 'slow' })
    await expect(reader.next()).resolves.toEqual({
      type: 'error', id: 'slow', message: 'request cancelled', fatal: false,
    })
    expect(observedAbort).toBe(true)
    input.end()
    await server.done
  })

  it('fails closed when the client protocol version differs', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const reader = new FrameReader(output)
    const server = serveStdioFetch({ handler: { fetch }, input, output })
    send(input, { type: 'hello', version: STDIO_FETCH_PROTOCOL_VERSION + 1 })
    await expect(reader.next()).resolves.toEqual({
      type: 'error',
      message: `protocol version mismatch: host=${String(STDIO_FETCH_PROTOCOL_VERSION)} client=${String(STDIO_FETCH_PROTOCOL_VERSION + 1)}`,
      fatal: true,
    })
    await server.done
  })

  it('forwards request metadata and supports bodyless responses under backpressure', async () => {
    let received: { url: string; method: string | undefined; body: string | undefined } | undefined
    const handler = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        received = {
          url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          method: init?.method,
          body: typeof init?.body === 'string' ? init.body : undefined,
        }
        return new Response(null, { status: 204 })
      },
    }
    const { input, reader, server } = await connect(handler, new PassThrough({ highWaterMark: 1 }))
    send(input, {
      type: 'request', id: 'body', path: '/api/host.describe?full=true', method: 'POST',
      headers: [['content-type', 'application/json']], body: '{}',
    })
    await expect(reader.next()).resolves.toMatchObject({ type: 'response', id: 'body', status: 204 })
    await expect(reader.next()).resolves.toEqual({ type: 'end', id: 'body' })
    expect(received).toEqual({ url: 'http://dsh.internal/api/host.describe?full=true', method: 'POST', body: '{}' })
    input.end()
    await server.done
  })

  it('rejects malformed ordering, paths, and duplicate active ids', async () => {
    const handler = {
      fetch: (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
        }),
    }
    const inputBeforeHello = new PassThrough()
    const outputBeforeHello = new PassThrough()
    const beforeHello = new FrameReader(outputBeforeHello)
    const unconnected = serveStdioFetch({ handler, input: inputBeforeHello, output: outputBeforeHello })
    send(inputBeforeHello, { type: 'request', id: 'early', path: '/api/host.describe', method: 'POST', headers: [] })
    await expect(beforeHello.next()).resolves.toMatchObject({ type: 'error', fatal: true })
    await unconnected.done

    const { input, reader, server } = await connect(handler)
    input.write('\n')
    input.write('{not-json}\n')
    await expect(reader.next()).resolves.toMatchObject({ type: 'error', fatal: false })
    send(input, { type: 'request', id: 'path', path: '/not-api', method: 'GET', headers: [] })
    await expect(reader.next()).resolves.toEqual({
      type: 'error', id: 'path', message: 'request.path must begin with /api/', fatal: false,
    })
    send(input, { type: 'cancel', id: 'unknown' })
    send(input, { type: 'request', id: 'same', path: '/api/session.search', method: 'POST', headers: [] })
    send(input, { type: 'request', id: 'same', path: '/api/session.search', method: 'POST', headers: [] })
    await expect(reader.next()).resolves.toMatchObject({ type: 'error', id: 'same', fatal: false })
    send(input, { type: 'hello', version: STDIO_FETCH_PROTOCOL_VERSION })
    send(input, { type: 'cancel', id: 'same' })
    const terminal = await Promise.all([reader.next(), reader.next()])
    expect(terminal).toContainEqual({ type: 'error', message: 'hello already received', fatal: true })
    expect(terminal).toContainEqual({ type: 'error', id: 'same', message: 'request cancelled', fatal: false })
    await server.done
  })

  it('reports a handler failure and aborts active work when explicitly closed', async () => {
    const throwing = await connect({ fetch: async () => { throw new Error('provider failed') } })
    send(throwing.input, { type: 'request', id: 'throw', path: '/api/host.describe', method: 'GET', headers: [] })
    await expect(throwing.reader.next()).resolves.toEqual({
      type: 'error', id: 'throw', message: 'Error: provider failed', fatal: false,
    })
    throwing.input.end()
    await throwing.server.done

    let aborted = false
    const active = await connect({
      fetch: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('closed'))
        }, { once: true })
      }),
    })
    send(active.input, { type: 'request', id: 'active', path: '/api/events.mux', method: 'GET', headers: [] })
    await active.server.close()
    expect(aborted).toBe(true)
    await active.server.close()
  })

  it('contains output-stream failures while reaching quiescence', async () => {
    const input = new PassThrough()
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) { callback(new Error('closed output')) },
    })
    output.on('error', () => {})
    const server = serveStdioFetch({ handler: { fetch }, input, output })
    send(input, { type: 'hello', version: STDIO_FETCH_PROTOCOL_VERSION })
    input.end()
    await server.done
  })
})
