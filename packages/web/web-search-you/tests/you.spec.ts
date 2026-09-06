import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import { YouSearchProvider, YOU_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-you'
import * as youPlugin from '@deepseek-ai/dsh-web-search-you'
import { mapYouEntry, mapYouResponse } from '../src/provider.ts'

const options = { apiKey: 'you-key', baseURL: 'https://ydc-index.test/v1' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('You.com result mapping', () => {
  it('maps a complete web result', () => {
    expect(mapYouEntry({
      url: 'https://a.test',
      title: 'A',
      snippets: ['first snippet', 'second snippet'],
      page_age: '3 hours ago',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'first snippet', publishedAt: '3 hours ago' })
  })

  it('uses description when no usable snippet is returned', () => {
    expect(mapYouEntry({ url: 'https://a.test', snippets: ['  ', 12], description: 'summary' }))
      .toEqual({ url: 'https://a.test', snippet: 'summary' })
  })

  it('drops entries without a usable URL and omits empty optional fields', () => {
    expect(mapYouEntry({ title: 'missing URL' })).toBeUndefined()
    expect(mapYouEntry({ url: ' ', title: 'blank URL' })).toBeUndefined()
    expect(mapYouEntry({ url: 'https://a.test', title: '', description: '', page_age: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('combines web then news sources and has no generated content', () => {
    const result = mapYouResponse({
      results: {
        web: [{ url: 'https://web.test', description: 'web summary' }],
        news: [{ url: 'https://news.test', title: 'News', snippets: ['news snippet'], page_age: '1 day ago' }],
      },
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://web.test', snippet: 'web summary' },
        { url: 'https://news.test', title: 'News', snippet: 'news snippet', publishedAt: '1 day ago' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('accepts an empty results object but rejects malformed result groups', () => {
    expect(mapYouResponse({ results: {} }).sources).toEqual([])
    expect(() => mapYouResponse({})).toThrow('missing results object')
    expect(() => mapYouResponse({ results: { web: {} } })).toThrow('result group is not an array')
  })
})

describe('YouSearchProvider availability', () => {
  it('requires a key and a parseable base URL', () => {
    expect(new YouSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
    expect(new YouSearchProvider({ ...options, baseURL: 'not a URL' }).available()).toBe(false)
    expect(new YouSearchProvider(options).available()).toBe(true)
  })

  it('rejects an invalid configured default count', () => {
    expect(new YouSearchProvider({ ...options, numResults: 0 }).available()).toBe(false)
    expect(new YouSearchProvider({ ...options, numResults: 1.5 }).available()).toBe(false)
  })
})

describe('YouSearchProvider request mapping', () => {
  it('sends the You.com query/count body and X-API-Key header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: {} }))
    vi.stubGlobal('fetch', fetchMock)
    await new YouSearchProvider({ ...options, numResults: 7 }).search({ query: 'latest news', maxResults: 3 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ydc-index.test/v1/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('you-key')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'latest news', count: 3 })
  })

  it('uses the configured count or the provider default and forwards cancellation', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new YouSearchProvider({ ...options, numResults: 7 }).search({ query: 'q' }, controller.signal)
    let [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ query: 'q', count: 7 })
    expect(init.signal).toBe(controller.signal)

    await new YouSearchProvider(options).search({ query: 'q' })
    ;[, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ query: 'q', count: 10 })
  })
})

describe('YouSearchProvider error handling', () => {
  it('maps a provider error detail to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'bad key' }, { status: 401 })))
    await expect(new YouSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('retains an HTTP fallback for a non-JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new YouSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'You.com API error (HTTP 502)' }))
  })

  it('maps network, abort, malformed success-body, and wrong-shape results', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new YouSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new YouSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new YouSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: { web: {} } })))
    await expect(new YouSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('web-search-you plugin registration', () => {
  it('registers and disposes the configured provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: {} })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: YOU_PROVIDER_ID })
    const fiber = await ctx.plugin(youPlugin, { apiKey: 'you-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('uses YDC_API_KEY and its official default base URL when config omits them', async () => {
    const previous = process.env.YDC_API_KEY
    process.env.YDC_API_KEY = 'environment-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ results: {} }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: YOU_PROVIDER_ID })
      const fiber = await ctx.plugin(youPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
      expect(url).toBe('https://ydc-index.io/v1/search')
      await fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.YDC_API_KEY
      else process.env.YDC_API_KEY = previous
    }
  })

  it('reports a missing credential without an explicit key or YDC_API_KEY', async () => {
    const previous = process.env.YDC_API_KEY
    delete process.env.YDC_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: YOU_PROVIDER_ID })
      await ctx.plugin(youPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    } finally {
      if (previous !== undefined) process.env.YDC_API_KEY = previous
    }
  })

  it('resolves the current stored YDC_API_KEY for each search', async () => {
    const previous = process.env.YDC_API_KEY
    delete process.env.YDC_API_KEY
    const directory = await mkdtemp(join(tmpdir(), 'dsh-web-search-you-'))
    const fetchMock = vi.fn(async () => jsonResponse({ results: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: YOU_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(directory, '.credentials.yaml'), watch: false })
      await ctx.plugin(youPlugin, { baseURL: 'https://ydc-index.test/v1' })
      const ref = credentialRef('YDC_API_KEY')
      await ctx.credentials.set(ref, 'first-key')
      await ctx.web.search({ query: 'first' })
      await ctx.credentials.set(ref, 'rotated-key')
      await ctx.web.search({ query: 'second' })
      const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>
      const headers = calls.map(([, init]) => init.headers as Record<string, string>)
      expect(headers.map(value => value['x-api-key'])).toEqual(['first-key', 'rotated-key'])
    } finally {
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
      if (previous === undefined) delete process.env.YDC_API_KEY
      else process.env.YDC_API_KEY = previous
    }
  })
})
