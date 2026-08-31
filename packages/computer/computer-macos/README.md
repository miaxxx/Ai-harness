# `@deepseek-ai/dsh-computer-macos`

English | [中文](README.zh.md)

macOS Provider for `dsh-computer`. It runs fixed JXA operations against the Accessibility API and uses `screencapture` only when a snapshot requests pixels. macOS must grant Accessibility; screenshots also require Screen Recording. The model never supplies executable JXA.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-computer`.

#### KV Cache effect

The Provider adds no context of its own; the consumer tool owns the durable result and cache behavior.

## Known Limitations and Deferred Work

- **Accessibility coverage** — custom controls with no useful accessibility labels require a future visual-coordinate fallback.
