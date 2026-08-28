# Agent side-effect governance audit

English | [中文](side-effect-audit.zh.md)

The governed boundary is **Agent-originated external side effects**, not every write performed by the Harness process. Session persistence, telemetry, caches, logs, and internal indexes remain runtime infrastructure.

## Required path

```text
Agent action
  -> Tool call
  -> validation
  -> hooks
  -> permission / approval
  -> guards
  -> sandbox policy
  -> capability provider execution
  -> result normalization / audit
  -> durable tool result
```

The existing Tool Execution Pipeline is the execution broker. No second broker or policy engine is introduced.

## Side-effect families

| Family | Model-facing entry | Execution owner | Static rule |
|---|---|---|---|
| Filesystem write/delete/edit | `@deepseek-ai/dsh-tool-*` filesystem tools | filesystem capability/provider family | tool package cannot import Node `fs` directly |
| Shell / subprocess | bash/pwsh/process/terminal tool packages | shell/terminal capability providers | tool package cannot import `child_process` directly |
| Git mutation | tool/capability composition | underlying governed process/filesystem capability | no alternate spawn/write path in model-facing tool package |
| Code runtime | workflow/code execution capability | runtime/provider implementation | same Tool Pipeline admission and cancellation contract |
| MCP mutation | MCP-facing tool/capability | MCP client/provider boundary | mutation remains a tool call; no UI/client bypass |
| Network write | web/MCP capability | network-capable provider | permission is policy; filesystem sandbox must not be described as network isolation |

## Mechanical enforcement

`scripts/verify-side-effect-boundaries.ts` scans every workspace package whose name starts with `@deepseek-ai/dsh-tool-`. Those model-facing packages may not directly import:

- `node:child_process` / `child_process`
- `node:fs`, `node:fs/promises`, or their unprefixed forms
- concrete `@deepseek-ai/dsh-*-sandbox` implementations

This is deliberately a narrow architecture verifier. Provider implementations, runtime infrastructure, persistence, and sandbox packages are outside the scan because those layers legitimately own OS primitives.

## Permission vs sandbox

Permission answers **should this operation run?** Sandbox answers **what can the process physically access if it runs?** A permission allow must never be treated as proof of confinement, and a sandbox denial must not be flattened into an ordinary tool-domain failure.

## Network boundary

The current sandbox vocabulary primarily confines filesystem effects. Network/process visibility is not claimed as fully isolated. Product/UI copy and error models should use language such as `filesystem-confined` where that distinction matters. Network isolation, namespace proxies, and enterprise policy engines are outside this phase.
