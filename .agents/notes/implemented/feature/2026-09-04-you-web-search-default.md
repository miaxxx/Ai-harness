# Agent Note: You.com is the default direct web-search provider

Status: implemented

English | [中文](2026-09-04-you-web-search-default.zh.md)

## Problem

The desktop composition exposed the standard `web_search` tool through DeepSeek's search provider, tying web retrieval to `DEEPSEEK_API_KEY` even when a deployment selected another chat-model provider. The product needs an independent web-search default without changing the model-facing tool or adding a parallel search path.

## Decision

`@deepseek-ai/dsh-web-search-you` registers the `you` provider id on `ctx.web`. The default ACP and shared bundle compositions select that id and use `apiKeyEnv: YDC_API_KEY` for You.com's direct `POST /v1/search` API. The provider resolves the reference for each search through `ctx.credentials`, or the launching environment when that service is absent. It maps web then news entries to the existing `WebSearchResult`, so `@deepseek-ai/dsh-tool-web`, citations, skills, and consumers retain their existing request and result types.

The direct API remains the default provider path. You.com's keyless free offering is its MCP endpoint; it is not an implicit fallback because that would add an unrelated tool transport and make configured-provider availability depend on a different product's quota and behavior.

## Alternatives considered

**Keep DeepSeek as the default.** Rejected because web retrieval would remain coupled to the primary model credential, which prevents an independent search configuration.

**Mount You.com MCP beside the existing provider.** Rejected because it would add a second model-visible search route instead of switching the standard `web_search` capability.

**Use a keyless MCP fallback behind `ctx.web`.** Rejected because the direct provider has a stable request/result mapping and explicit credential failure; silently changing transport and quota state would make the configured provider's behavior ambiguous.

## Consequences

Desktop and shared bundle deployments require `YDC_API_KEY` for web search. Without it, the existing selected-provider-unavailable error remains actionable. The desktop **Plugins → Plugin configuration → Web search** card addresses that same reference through the credentials domain, reports only whether a key is configured, and never writes the literal into the settings document. Direct API credentials are explicit in the composition and package README; deployments may still select another installed provider by configuration. Unit tests cover result mapping, request construction, cancellation, error translation, registration, and the settings-card credential write; the real-API smoke self-skips without the key.
