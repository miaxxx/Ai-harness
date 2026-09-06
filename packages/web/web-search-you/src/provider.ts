/**
 * You.com Web Search provider, mapping its web and news result groups into
 * `ctx.web` sources.
 * @module @deepseek-ai/dsh-web-search-you/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { YouSearchEntry, YouSearchError, YouSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const YOU_PROVIDER_ID = 'you'
/** Official You.com Web Search endpoint. */
export const YOU_DEFAULT_BASE_URL = 'https://ydc-index.io/v1'
/** Default number of source results requested from You.com. */
export const YOU_DEFAULT_NUM_RESULTS = 10

/** Resolved options for one You.com search provider. */
export interface YouSearchProviderOptions {
  /** Literal direct API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference displayed by missing-key diagnostics. */
  apiKeyEnv?: CredentialRef
  /** API base URL; the provider appends `/search`. */
  baseURL: string
  /** Default result count when a request does not carry `maxResults`. */
  numResults?: number
}

/** Return a non-blank string, omitting non-text provider fields. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Return non-blank strings from an optional provider list. */
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const output: string[] = []
  for (const item of value as unknown[]) {
    const candidate = text(item)
    if (candidate !== undefined) output.push(candidate)
  }
  return output
}

/**
 * Map one You.com result only when it provides a usable URL.
 *
 * @param entry - one entry from You.com's web or news result group.
 * @returns a normalized source, or `undefined` when no URL is available.
 */
export function mapYouEntry(entry: YouSearchEntry): WebSearchSource | undefined {
  const url = text(entry.url)
  if (url === undefined) return undefined
  const snippet = strings(entry.snippets)[0] ?? text(entry.description)
  const title = text(entry.title)
  const publishedAt = text(entry.page_age)
  return {
    url,
    ...title === undefined ? {} : { title },
    ...snippet === undefined ? {} : { snippet },
    ...publishedAt === undefined ? {} : { publishedAt },
  }
}

/**
 * Convert You.com's web/news result arrays into portable citation-ready
 * sources, retaining their provider order (web before news).
 *
 * @param response - parsed body from `POST /v1/search`.
 * @returns normalized sources without generated answer content.
 */
export function mapYouResponse(response: YouSearchResponse): WebSearchResult {
  if (response.results === undefined) throw new TypeError('missing results object')
  const sources: WebSearchSource[] = []
  for (const group of [response.results.web, response.results.news]) {
    if (group === undefined) continue
    if (!Array.isArray(group)) throw new TypeError('result group is not an array')
    for (const row of group as unknown[]) {
      if (typeof row !== 'object' || row === null) continue
      const source = mapYouEntry(row)
      if (source !== undefined) sources.push(source)
    }
  }
  return {
    sources,
    truncated: false,
  }
}

/** You.com-backed standard web-search provider. */
export class YouSearchProvider implements WebSearchProvider {
  readonly id = YOU_PROVIDER_ID

  constructor(private readonly options: YouSearchProviderOptions) {}

  available(): boolean {
    return ((this.options.apiKey?.length ?? 0) > 0 || this.options.resolveApiKey !== undefined)
      && isValidBaseUrl(this.options.baseURL)
      && (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const count = request.maxResults ?? this.options.numResults ?? YOU_DEFAULT_NUM_RESULTS
    const apiKey = await this.apiKey(signal)
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST', redirect: 'error',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: request.query, count }),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('You.com search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`You.com search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw new WebError(await errorMessage(response), 'WEB_PROVIDER_ERROR')
    try {
      return mapYouResponse(await response.json() as YouSearchResponse)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('You.com search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`You.com returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /** Resolve one request's direct API key without retaining credential-service state. */
  private async apiKey(signal?: AbortSignal): Promise<string> {
    if (isSignalAborted(signal)) throw new WebError('You.com search aborted', 'WEB_ABORTED', { cause: signal?.reason })
    if (this.options.apiKey !== undefined && this.options.apiKey.length > 0) return this.options.apiKey
    let resolved: string | undefined
    try {
      resolved = await this.options.resolveApiKey?.()
    } catch (error: unknown) {
      if (isSignalAborted(signal) || isAbortError(error)) throw new WebError('You.com search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error })
      throw new WebError(`You.com search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (isSignalAborted(signal)) throw new WebError('You.com search aborted', 'WEB_ABORTED', { cause: signal?.reason })
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `You.com search has no API key for "${this.options.apiKeyEnv ?? 'YDC_API_KEY'}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the web-search-you config`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/** True when a configured endpoint parses as an absolute URL. */
function isValidBaseUrl(value: string): boolean {
  return URL.canParse(value)
}

/** True when a configured result count is a positive whole number. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True when fetch reports the standard abort error. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True when a caller cancelled the surrounding search. */
function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Extract a provider error string while preserving the HTTP fallback. */
async function errorMessage(response: Response): Promise<string> {
  const fallback = `You.com API error (HTTP ${response.status})`
  try {
    const body = await response.json() as YouSearchError
    return text(body.detail) ?? text(body.message) ?? text(body.error) ?? fallback
  } catch (error: unknown) {
    if (isAbortError(error)) throw new WebError('You.com search aborted', 'WEB_ABORTED', { cause: error })
    return fallback
  }
}
