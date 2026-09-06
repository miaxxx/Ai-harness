/**
 * Wire types for You.com's `POST /v1/search` API. The provider validates only
 * the parts needed to produce portable `WebSearchSource` entries.
 *
 * @module @deepseek-ai/dsh-web-search-you/types
 */

/** One web or news result returned by You.com. */
export interface YouSearchEntry {
  /** Absolute source URL, when You.com returned one. */
  url?: unknown
  /** Human-readable result title. */
  title?: unknown
  /** Result summary used when no snippet is available. */
  description?: unknown
  /** Extracted source snippets, ordered by You.com relevance. */
  snippets?: unknown
  /** Provider-supplied publication-age string for news items. */
  page_age?: unknown
}

/** You.com's `POST /v1/search` response envelope. */
export interface YouSearchResponse {
  /** Search-result groups returned by the direct Web Search API. */
  results?: {
    /** General web results. */
    web?: unknown
    /** News results. */
    news?: unknown
  }
}

/** Best-effort You.com API error body. */
export interface YouSearchError {
  /** Structured error detail when present. */
  detail?: unknown
  /** Provider message when present. */
  message?: unknown
  /** Provider error string when present. */
  error?: unknown
}
