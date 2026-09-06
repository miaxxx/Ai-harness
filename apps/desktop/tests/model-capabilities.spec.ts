import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeDesktopModel } from '../src/desktop-model-capabilities.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const request = {
  baseURL: 'https://gateway.example/v1',
  model: 'model-a',
  protocol: 'openai-completions' as const,
  apiKey: 'secret-key',
}

describe('Desktop model capability verification', () => {
  it('verifies tools and vision while adopting advertised token capacities', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ choices: [{ message: { content: 'OK' } }] }))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: 'OK' } }] }))
      .mockResolvedValueOnce(json({ data: [{ id: 'model-a', context_length: 131_072, max_output_tokens: 16_384 }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(probeDesktopModel(request)).resolves.toEqual({
      input: ['text', 'image'],
      verified: true,
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const baseline = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://gateway.example/v1/chat/completions')
    expect(baseline).toMatchObject({ model: 'model-a', stream: false })
    expect(baseline.tools).toEqual([expect.objectContaining({ type: 'function' })])
    const vision = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as { messages: Array<{ content: unknown[] }> }
    expect(vision.messages[0]?.content).toContainEqual(expect.objectContaining({ type: 'image_url' }))
  })

  it('keeps a working text model when the optional image request is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ choices: [] }))
      .mockResolvedValueOnce(json({ error: { message: 'images are unsupported' } }, 400))
      .mockResolvedValueOnce(json({ data: [{ id: 'model-a' }] })))

    await expect(probeDesktopModel(request)).resolves.toEqual({ input: ['text'], verified: true })
  })

  it('rejects settings before persistence when the text and tool request is incompatible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: { message: 'tools are unsupported' } }, 400)))

    await expect(probeDesktopModel(request)).rejects.toThrow('模型兼容性验收失败：HTTP 400：tools are unsupported')
  })

  it('uses the Responses request fields without sending a reasoning effort', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ output: [] }))
      .mockResolvedValueOnce(json({ error: { message: 'no vision' } }, 400))
      .mockResolvedValueOnce(json({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await probeDesktopModel({ ...request, protocol: 'openai-responses' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://gateway.example/v1/responses')
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'model-a', input: 'Reply with OK only. Do not call tools.', stream: false })
    expect(body).not.toHaveProperty('reasoning')
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'compatibility_probe' })])
  })
})
