# @deepseek-ai/dsh-acp-client

English | [中文](README.zh.md)

Product-side Node.js transport for CLI, IDE, and Desktop hosts that drive a standalone DeepSeek Harness Runtime over Agent Client Protocol (ACP) stdio. The package owns the child process and ACP connection only. It does not own Agent, Session, tools, persistence, permission policy, or sandbox behavior; those remain inside the spawned Runtime.

## Ownership

| Concern | Owner |
|---|---|
| Runtime executable selection and process lifetime | Product host through `AcpRuntimeSpec` and `dispose()` |
| ACP framing, initialization, updates, permission requests | `@deepseek-ai/dsh-acp-client` + `@agentclientprotocol/sdk` |
| Session list/load/resume/new/prompt/close semantics | ACP server in the Runtime |
| Durable Session identity and replay | Runtime persistence |
| Agent Loop and model execution | Runtime |
| Tool permission and sandbox enforcement | Runtime |
| CLI/IDE/Desktop rendering and human interaction | The consuming product |

Consumers receive the standard `ClientSideConnection` and call ACP methods directly. This package deliberately does not add a second session facade or translate ACP into another product protocol.

## API

`connectAcpRuntime(spec, handlers)` spawns the configured executable with stdin/stdout reserved for ACP, initializes the protocol, and returns `{ client, dispose }`.

`AcpRuntimeSpec` contains `command`, `args`, `cwd`, and optional explicit environment additions. The Runtime command is deployment-owned and replaceable; clients do not import Runtime packages to create Agent or Session objects themselves.

`AcpClientHandlers.onSessionUpdate` receives standard ACP session updates. `onPermissionRequest` is optional; when omitted, permission requests resolve as `cancelled`, so a missing UI never becomes implicit approval. `onRuntimeStderr` may route Runtime diagnostics into an IDE or Desktop log surface; without it, stderr is inherited. ACP frames remain on stdout only.

## Lifecycle

Disposal first closes Runtime stdin. A conforming ACP Runtime treats EOF as the cooperative shutdown signal, quiesces live agents, flushes durable session state, and exits. If the child does not exit within the bounded EOF grace, the client escalates to `SIGTERM` on POSIX and finally `SIGKILL`; Windows goes directly to forced termination after the EOF grace. `dispose()` resolves only after process exit and is idempotent for one connection.

Startup failure also tears down the child before the connection attempt rejects. A product may therefore treat a resolved `connectAcpRuntime()` as one initialized live ACP connection and a resolved `dispose()` as process quiescence.

## Security

This is not a sandbox and does not make authorization decisions. It transports permission requests to the owning product and defaults to rejection when no permission handler exists. The Runtime remains responsible for the independent Permission (should execute) and Sandbox (can execute) decisions.

The package does not scrub inherited environment variables. Product launch policy decides which environment is safe to inherit and may pass explicit additions through `AcpRuntimeSpec.env`. Runtime stdout must contain ACP frames only; diagnostics belong on stderr.

## Model Experience

None directly. The package is outside the Harness process and contributes no model-visible content. Prompt blocks, tool results, and durable history are defined by ACP and the Runtime session log.

#### KV Cache effect

None. This transport does not alter model requests or persistent session content.

## Known Limitations and Deferred Work

- Transport is stdio-only in the current standalone-runtime phase. Socket or daemon discovery is intentionally out of scope.
- One connection owns one Runtime subprocess. Multi-process activation of the same persisted Session remains unsupported in P0.
- Environment scrubbing is product-launch policy; this package only merges explicitly supplied additions onto the launching process environment.
