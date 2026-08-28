# Standalone Runtime Boundary

Ai-harness is a **standalone, event-sourced, tool-governed, sandbox-aware Agent Runtime**. Product surfaces such as Desktop, CLI, and IDE are clients of that runtime; they must not become alternate owners of agent logic.

## Architecture invariants

1. **Clients do not reach Agent internals.** Product clients communicate through ACP. Programmatic embedding and automation may continue to use the SDK boundary where appropriate.
2. **Model-visible durable state is reconstructable from the Session model.** Long-lived state that can affect a future model request must be durable before it becomes authoritative, or have an equivalent durable representation.
3. **Agent-originated external side effects go through the Tool Execution Pipeline.** Validation, hooks, permission, approval, guards, sandbox policy, execution, result normalization, and audit remain one governed path. Runtime housekeeping such as persistence, telemetry, caches, logs, and indexes is not an Agent-originated external side effect.
4. **Permission and sandbox are different boundaries.** Permission decides whether an operation should run; sandbox enforcement decides what it can physically access if it runs.
5. **Transport is an adapter.** ACP may use stdio today and another transport later without changing Agent, Session, Tool, Permission, or Sandbox semantics.

## Ownership

Durable session identity belongs to Session persistence. An ACP connection owns only live runtime resources, such as the active Agent handle and in-flight protocol work. Disconnecting a client may cancel, quiesce, flush, and dispose live resources, but it must not redefine durable session lifetime.

`session/close` therefore means **release active resources**, not delete conversation history. Persistence deletion is not advertised until the persistence seam itself owns a deletion capability.

## Dependency direction

```text
Clients
  |
  v
 ACP
  |
  v
Agent
  |
  +---- Session ---- Persistence
  |
  +---- Tools ------ Capability providers
  |
  +---- LLM
```

Forbidden reverse coupling includes `Session -> ACP`, `Agent -> Desktop`, `Tool -> IDE/VSCode`, `Sandbox -> UI`, and `LLM -> Client`.

## Client boundary ratchet

The repository is migrating incrementally, so the mechanical check is a **ratchet**, not a flag-day rewrite. A client surface is added to the enforced set after its runtime dependencies have been moved behind ACP. Once protected, it may not directly import these runtime-internal packages:

- `@deepseek-ai/dsh-agent-loop`
- `@deepseek-ai/dsh-tools`
- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-sandbox`

Desktop is protected now. CLI is intentionally not yet protected because its ACP migration is a later phase; adding CLI to the protected set is part of the migration definition of done, not a reason to grandfather new violations forever.

The verifier lives at `scripts/verify-client-runtime-boundary.ts` and should stay deliberately small. Do not replace it with a policy framework or a second dependency graph system.

## Protocol boundaries

Internal Session events are not wire DTOs. ACP must project durable/runtime read models into ACP-specific semantic updates. Historical replay and live streaming must share the same projection semantics so reconnect behavior cannot drift from live behavior.

Likewise, ACP DTOs stay at the protocol boundary and must not leak into the Agent loop or persistence layer.

## Non-goals for this phase

Do not introduce a RuntimeManager, SessionManager, PluginManager, ExecutionManager, message bus, distributed lock, daemon framework, generic policy engine, alternate ACP protocol, CRDT, container orchestrator, or remote transport merely to prepare for hypothetical future needs.

Prefer existing primitives and small functions. Add a new abstraction only when it removes demonstrated duplication or owns a real lifecycle/concurrency/compatibility boundary.
