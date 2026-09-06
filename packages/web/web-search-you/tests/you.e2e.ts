import { describe, expect, it } from 'vitest'
import { YouSearchProvider, YOU_DEFAULT_BASE_URL } from '@deepseek-ai/dsh-web-search-you'

/** Real-API smoke; intentionally self-skips in secret-free environments. */
const apiKey = process.env.YDC_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('YouSearchProvider real API', () => {
  it('returns usable URLs for a live query', async () => {
    const result = await new YouSearchProvider({
      apiKey: apiKey!,
      baseURL: process.env.YDC_BASE_URL ?? YOU_DEFAULT_BASE_URL,
    }).search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
