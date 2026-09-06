# @deepseek-ai/dsh-web-search-you

English | [中文](README.zh.md)

A [You.com Web Search API](https://documentation.you.com/) provider for the harness [web capability](../web/README.md) (`ctx.web`). It calls `POST /v1/search` with the direct API's `X-API-Key` authentication, maps `results.web[]` and `results.news[]` into normalized sources, and returns no generated answer content.

This implementation registers a provider into `ctx.web`; [`@deepseek-ai/dsh-tool-web`](../tool-web/README.md) owns the model-facing `web_search` tool.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Literal direct You.com API key. Prefer `apiKeyEnv` so no secret enters the config file. |
| `apiKeyEnv` | `YDC_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or from the launching environment when that service is absent. A missing value fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://ydc-index.io/v1` | API base; `/search` is appended. An unparseable value makes the provider unavailable. |
| `numResults` | `10` | Count sent when a request omits `maxResults`. Must be a positive integer. |

```yaml
- id: web-search-you
  name: '@deepseek-ai/dsh-web-search-you'
  config:
    apiKeyEnv: YDC_API_KEY
```

## Mapping and failures

The provider concatenates web results before news results. A result needs a non-blank `url`; `title` maps when present, `snippet` takes the first non-blank `snippets[]` entry or falls back to `description`, and `publishedAt` takes `page_age`. The service enforces the final `maxResults` bound. Network failures, HTTP errors, malformed result groups, and unreadable bodies become `WEB_PROVIDER_ERROR`; standard fetch cancellation becomes `WEB_ABORTED`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which exposes the normalized URLs, titles, snippets, and publication ages as the existing `web_search` output without adding a model tool, prompt wording, or source field.

#### KV Cache effect

No direct invalidation; the tool consumer owns model-request prefix changes.

## Known Limitations and Deferred Work

- The direct API requires a key under `YDC_API_KEY` by default. You.com's keyless free tier is an MCP endpoint and is not used as a hidden fallback for the standard `web_search` provider.
- The provider sends only `query` and `count`; domain, recency, locale, and other You.com controls wait for provider-neutral fields on `WebSearchRequest`.
- `page_age` is preserved as the provider's display string rather than parsed into a timestamp.
