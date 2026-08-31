# guard/ — agent-behavior guard family

English | [中文](README.zh.md)

Behavioral guard plugins constrain completion procedure, watch for unproductive patterns, and enforce per-call budgets. A guard is a self-contained consumer of core services and extension points, not a swappable capability.

| Package | Role | ctx key |
|---|---|---|
| [`delivery-quality-policy/`](delivery-quality-policy/README.md) | Global final-state acceptance and repair-loop policy | contributes to `ctx.systemPrompt` |
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Advisory reminders for repeated tool calls | listens on tool and agent events |
| [`timeout-policy/`](timeout-policy/README.md) | Arms per-call tool deadlines as deployment policy | registers a `tools/execute` listener |

Delivery acceptance is a stable system-prompt section paired with the product's artifact-routed verification Skill. Reminders travel as `additionalContexts` on the `tools/post-execute` decision and are appended as logged plugin-sourced `user/message` events ([tools](../../docs/subsystems/tools.md)); the timeout split across `dsh-timeout`, capability termination, and this policy layer is recorded in the [timeout-library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md).
