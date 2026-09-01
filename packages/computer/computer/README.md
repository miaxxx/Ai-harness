# `@deepseek-ai/dsh-computer`

English | [中文](README.zh.md)

Provider-neutral local computer-control runtime. `ctx.computer` aggregates available Providers by target kind (`app`, `browser-tab`, or `desktop`), routes each observation/action to a Provider that supports that target, and returns a fresh bounded observation after every action. Element ids are scoped to one observation and must be treated as expired after the next action or observation.

Multiple Providers can coexist in the same composition. The `provider` config field is only a same-target-kind tie-breaker when more than one available Provider could serve that target; it does not globally hide Providers for other target kinds. Desktop therefore can expose native macOS targets and Chromium tabs at the same time when both Providers are available.

The runtime contract keeps semantic accessibility state separate from visual capture. Providers must report honest capture scope and stable Computer errors rather than silently substituting a different target or full-desktop pixels for an unavailable app/window capture.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-computer`.

#### KV Cache effect

The Provider registry adds no model context of its own. The consumer tool owns model-visible observations, short-lived per-agent state, and diff rendering.

## Known Limitations and Deferred Work

- **Provider availability** — this package owns no platform implementation; a deployment mounts suitable Providers.
- **No universal locator layer** — semantic ids are intentionally observation-scoped; OCR/CV element location is outside this runtime contract.
