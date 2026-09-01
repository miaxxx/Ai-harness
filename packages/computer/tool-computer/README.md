# `@deepseek-ai/dsh-tool-computer`

English | [中文](README.zh.md)

Exposes one model-facing `computer` tool with the bounded actions `list`, `observe`, `click`, `drag`, `set_value`, `type_text`, `paste`, `key`, `scroll`, and `secondary_action`. `list` and accessibility-only `observe` are read-only. Visual observation and every mutating action use the existing one-shot approval service; no model call obtains a persistent app grant.

The tool prefers semantic, observation-scoped element ids. Every mutation returns a fresh observation, invalidating ids from the previous observation. For semantic post-state it emits a bounded diff against the prior per-Agent + target observation; explicit `observe` returns full current state and is the recovery path after stale/ambiguous state. Recent observations expire after a short TTL rather than becoming durable control state.

Visual observations are saved through `ctx.attachments`, preserving the image as durable model-visible tool content while the control cache itself remains short-lived.

## Model Experience

### Request context and condition

#### What the model sees

One `computer` schema and each returned target observation. Accessibility state is the default; a requested visual observation is returned as an image tool-result block. Mutation results contain fresh state and, when semantic before/after state is available, a concise change diff.

#### Token effect

Full semantic state enters context on explicit observation. Post-action semantic results preferentially surface the bounded diff, reducing repeated-state tokens; requested screenshots still enter the tool-result message.

#### KV Cache effect

Each action appends a tool result and invalidates later request suffix reuse.

## Known Limitations and Deferred Work

- **No persistent app grant** — every visual observation or state-changing operation receives an explicit one-shot approval decision.
- **No persistent macro state** — the short-lived observation cache exists only to enforce freshness and render diffs, not to schedule or replay gestures.
