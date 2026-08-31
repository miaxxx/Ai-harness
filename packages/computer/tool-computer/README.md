# `@deepseek-ai/dsh-tool-computer`

English | [中文](README.zh.md)

Exposes `computer`. `list` and text-only `inspect` are read-only. Every screenshot, click, text entry, key press, and scroll requests a one-shot decision through `ctx.approval`; no model call obtains a persistent app grant. A screenshot is saved through `ctx.attachments` and therefore stays durable model-visible tool content.

## Model Experience

### Request context and condition

#### What the model sees

The `computer` schema and each returned app snapshot. A requested screenshot is an image tool-result block.

#### Token effect

Snapshot text and any screenshot enter the tool-result message.

#### KV Cache effect

Each action appends a tool result and invalidates later request suffix reuse.

## Known Limitations and Deferred Work

- **No persistent app grant** — the initial version asks for every screenshot or mutating app operation.
