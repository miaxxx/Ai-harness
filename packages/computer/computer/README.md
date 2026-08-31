# `@deepseek-ai/dsh-computer`

English | [中文](README.zh.md)

Provider-neutral local computer-control capability. `ctx.computer` selects one available Provider and exposes bounded app discovery, inspection, and actions. Inspection element ids expire after the next inspection or action.

The Desktop composition selects the Chromium DevTools provider when `DSH_BROWSER_CDP_URL` names a local endpoint; otherwise it selects the macOS Accessibility provider. A composition can pin a different Provider with the `provider` config field.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-computer`.

#### KV Cache effect

The provider registry adds no context of its own; the consumer tool owns the durable result and cache behavior.

## Known Limitations and Deferred Work

- **Provider availability** — this package owns no platform implementation; a deployment mounts a suitable Provider.
