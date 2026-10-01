/** Privileged, bounded discovery of models advertised by an OpenAI-compatible endpoint. */
import type { DesktopModelCatalog, DesktopModelSummary } from '../../shared.ts'

/** Inputs retained only in Electron Main while discovering a model directory. */
export interface DesktopModelCatalogRequest {
  baseURL: string
  apiKey: string
  configuredModel: string
}

const TIMEOUT_MS = 15_000
const MAX_BYTES = 1024 * 1024
const MAX_MODELS = 1000

/**
 * Parse advertised model ids, rejecting malformed records and deduplicating ids.
 * @param value - JSON from the endpoint's models response.
 * @returns Models with provider display names when present.
 */
export function parseDesktopModelCatalog(value: unknown): DesktopModelSummary[] {
  if (typeof value !== 'object' || value === null || !('data' in value) || !Array.isArray(value.data)) {
    throw new Error('模型列表不是 OpenAI 兼容的 data 数组')
  }
  if (value.data.length > MAX_MODELS) throw new Error('模型列表超过 1000 项上限')
  const entries = new Map<string, DesktopModelSummary>()
  for (const item of value.data as unknown[]) {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('模型列表包含无效的模型 ID')
    }
    const id = item.id.trim()
    const displayName: unknown = ('display_name' in item ? item.display_name : undefined) ?? ('name' in item ? item.name : undefined)
    entries.set(id, { id, name: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : id })
  }
  return [...entries.values()]
}

async function readCatalog(response: Response): Promise<unknown> {
  if (response.body === null) throw new Error('模型接口没有返回列表')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = '', bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) throw new Error('模型列表超过 1 MiB 上限')
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } finally {
    await reader.cancel().catch(() => { /* The directory request owns no reusable response body. */ })
  }
}

/**
 * Detect advertised models; preserve an explicitly configured model on unsupported listings.
 * Directory membership does not prove inference access; switching separately probes the model.
 * @param request - Validated endpoint and Main-process credential.
 * @returns The detected directory or an explicit configured-model fallback with a warning.
 */
export async function discoverDesktopModels(request: DesktopModelCatalogRequest): Promise<DesktopModelCatalog> {
  const configured = request.configuredModel.trim()
  try {
    const response = await fetch(`${request.baseURL.replace(/\/+$/, '')}/models`, {
      headers: { authorization: `Bearer ${request.apiKey}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`模型列表请求失败（HTTP ${response.status}）`)
    const models = parseDesktopModelCatalog(await readCatalog(response))
    if (models.length === 0) throw new Error('接口返回了空模型列表')
    return { models, source: 'endpoint' }
  } catch (error: unknown) {
    const warning = error instanceof SyntaxError ? '模型列表不是有效 JSON'
      : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? '检测模型列表超时'
        : error instanceof TypeError ? '无法连接模型列表接口'
          : error instanceof Error ? error.message : '模型列表检测失败'
    return { models: configured ? [{ id: configured, name: configured }] : [], source: 'configured', warning }
  }
}
