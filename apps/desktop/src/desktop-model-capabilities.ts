/** Bounded capability verification for one Desktop OpenAI-compatible endpoint. */

import type { DesktopModelCapabilities, DesktopModelProtocol } from './shared.ts'

const PROBE_TIMEOUT_MS = 20_000
const MAX_REPLY_BYTES = 64 * 1024
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export interface DesktopModelProbeRequest {
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  apiKey: string
}

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path}`
}

function positiveInteger(...values: readonly unknown[]): number | undefined {
  return values.find(value => typeof value === 'number' && Number.isInteger(value) && value > 0) as number | undefined
}

async function readBounded(response: Response): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_REPLY_BYTES) throw new Error('模型接口返回内容超过兼容性验收上限')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {
      // A completed or deliberately abandoned probe owns no reusable response body.
    })
  }
}

function responseMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = body.error?.message ?? body.message
    if (typeof message === 'string' && message.trim() !== '') return message.trim().slice(0, 300)
  } catch {
    // Non-JSON provider diagnostics are still useful after whitespace is collapsed below.
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

async function request(request: DesktopModelProbeRequest, body: object): Promise<void> {
  const path = request.protocol === 'openai-completions' ? 'chat/completions' : 'responses'
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
  let response: Response
  let text: string
  try {
    response = await fetch(endpoint(request.baseURL, path), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${request.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    text = await readBounded(response)
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new Error('模型兼容性验收超时', { cause: error })
    throw new Error('无法连接模型接口', { cause: error })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    const detail = responseMessage(text)
    throw new Error(`HTTP ${response.status}${detail === '' ? '' : `：${detail}`}`)
  }
}

const TOOL = {
  type: 'function',
  function: {
    name: 'compatibility_probe',
    description: 'A no-op tool used only to verify function-tool request compatibility.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}

function baselineBody(request: DesktopModelProbeRequest): object {
  if (request.protocol === 'openai-completions') {
    return {
      model: request.model,
      messages: [
        { role: 'system', content: 'You are verifying API compatibility.' },
        { role: 'user', content: 'Reply with OK only. Do not call tools.' },
      ],
      tools: [TOOL],
      stream: false,
    }
  }
  return {
    model: request.model,
    instructions: 'You are verifying API compatibility.',
    input: 'Reply with OK only. Do not call tools.',
    tools: [{
      type: 'function',
      name: TOOL.function.name,
      description: TOOL.function.description,
      parameters: TOOL.function.parameters,
    }],
    stream: false,
  }
}

function visionBody(request: DesktopModelProbeRequest): object {
  if (request.protocol === 'openai-completions') {
    return {
      model: request.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with OK only.' },
          { type: 'image_url', image_url: { url: PIXEL } },
        ],
      }],
      stream: false,
    }
  }
  return {
    model: request.model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Reply with OK only.' },
        { type: 'input_image', image_url: PIXEL },
      ],
    }],
    stream: false,
  }
}

async function listedCapacities(request: DesktopModelProbeRequest): Promise<Pick<DesktopModelCapabilities, 'contextWindow' | 'maxOutputTokens'>> {
  try {
    const response = await fetch(endpoint(request.baseURL, 'models'), {
      headers: { authorization: `Bearer ${request.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return {}
    const text = await readBounded(response)
    const data = (JSON.parse(text) as { data?: unknown }).data
    if (!Array.isArray(data)) return {}
    const entry = data.find(value => typeof value === 'object' && value !== null && (value as { id?: unknown }).id === request.model) as Record<string, unknown> | undefined
    if (entry === undefined) return {}
    const contextWindow = positiveInteger(entry.context_window, entry.context_length)
    const maxOutputTokens = positiveInteger(entry.max_output_tokens, entry.max_tokens)
    return {
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
    }
  } catch {
    // Model listings and their non-standard capacity fields are optional.
    return {}
  }
}

/** Verify text/tool requests, then conservatively detect optional image input and advertised capacities. */
export async function probeDesktopModel(requestValue: DesktopModelProbeRequest): Promise<DesktopModelCapabilities> {
  const requestValueCopy = { ...requestValue }
  try {
    await request(requestValueCopy, baselineBody(requestValueCopy))
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`模型兼容性验收失败：${detail}`, { cause: error })
  }
  let image = false
  try {
    await request(requestValueCopy, visionBody(requestValueCopy))
    image = true
  } catch {
    // Text/tool compatibility already passed; optional image failure means text-only.
  }
  return {
    input: image ? ['text', 'image'] : ['text'],
    verified: true,
    ...await listedCapacities(requestValueCopy),
  }
}
