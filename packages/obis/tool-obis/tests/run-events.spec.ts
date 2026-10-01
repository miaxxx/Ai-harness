import { describe, expect, it, vi } from 'vitest'
import { ObisBridgeClient } from '@deepseek-ai/dsh-obis-bridge'
import { createRunEventTool } from '../src/run-events.ts'

const context = { environmentId: 'test', runId: 'run', capabilityLease: 'private-lease' }
const event = { id: 'event-2', type: 'query.completed', runId: 'run', occurredAt: '2026-10-01T00:00:00Z', correlationId: 'corr-query', payload: {} }
const client = (transport: typeof fetch) => new ObisBridgeClient({ baseUrl: 'https://api.example.test', tokenProvider: async () => 'private-token', fetch: transport })

describe('bounded Host run event read', () => {
  it('uses the private lease and cursor, returns a public event, and closes the stream', async () => {
    const cancel = vi.fn()
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)) }, cancel,
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const result = await createRunEventTool(client(transport), 5000).execute({ afterId: 'event-1' }, context)
    expect(result).toEqual({ runId: 'run', event, timedOut: false })
    expect(JSON.stringify(result)).not.toMatch(/private-lease|private-token/)
    expect(String(transport.mock.calls[0]?.[0])).toContain('after=event-1')
    const headers = new Headers(transport.mock.calls[0]?.[1]?.headers)
    expect(headers.get('OHP-Capability-Lease')).toBe('private-lease')
    expect(headers.get('OHP-Agent-Run')).toBe('run')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('preserves Kernel authorization refusal', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'OHP_FORBIDDEN', message: 'Revoked', correlationId: 'corr-deny', retryable: false } }), { status: 403 }))
    await expect(createRunEventTool(client(transport), 5000).execute({}, context)).rejects.toMatchObject({ status: 403, code: 'OHP_FORBIDDEN' })
  })

  it('bounds waiting without swallowing caller cancellation', async () => {
    const transport: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) reject(signal.reason)
      else signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    })
    expect(await createRunEventTool(client(transport), 5).execute({}, context)).toEqual({ runId: 'run', event: null, timedOut: true })
    const controller = new AbortController()
    const pending = createRunEventTool(client(transport), 5000).execute({}, { ...context, signal: controller.signal })
    const reason = new Error('User stopped')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('refuses missing run authority before contacting the server', async () => {
    const transport = vi.fn<typeof fetch>()
    await expect(createRunEventTool(client(transport), 5000).execute({}, { environmentId: 'test', runId: 'run' })).rejects.toThrow('Host lease')
    expect(transport).not.toHaveBeenCalled()
  })
})
