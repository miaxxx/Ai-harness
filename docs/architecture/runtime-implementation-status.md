# Standalone Runtime implementation status

English | [中文](runtime-implementation-status.zh.md)

This tracker records the Standalone Agent Runtime plan. Durable Runtime work precedes product-client adapters, and each completed phase has an executable boundary or portability check.

## Phase A — Persistent ACP

- [x] Architecture boundary guardrails
- [x] Pure durable-event projection boundary
- [x] Optional SessionPersistence capability wiring
- [x] `session/list` with cwd filter and opaque cursor pagination
- [x] Shared persisted-session activation through `AgentRegistry.resume()`
- [x] `session/load` restore + replay
- [x] `session/resume` restore without replay
- [x] `session/close` releases live resources without deleting persistence
- [x] Connection teardown preserves durable session identity
- [x] JSONL restart integration test
- [x] SQLite restart integration test
- [x] Cross-client/runtime portability E2E

Acceptance: ACP contract tests plus JSONL/SQLite restart tests reconstruct durable history after the original Harness instance is gone. Replay and live delivery use the same projection boundary.

## Phase B — Client separation

- [x] CLI product-client path uses ACP
- [x] CLI client path has no Agent/Session/Tool/Sandbox runtime dependency
- [x] CLI client path cannot invoke model-facing tools directly
- [x] CLI machine-mode permission handling fails closed
- [x] Release-shaped built CLI → built ACP Runtime cross-process E2E
- [x] Fresh CLI processes can list, load, replay, and continue one durable Session

Acceptance: the CI gate builds the authoritative host release closure, builds the CLI binary, then proves that process A can create/close a Session and later processes can list/load/continue it solely through persistence + ACP.

## Phase C — IDE

- [x] VS Code extension launches a replaceable Harness ACP subprocess
- [x] Extension host imports ACP/product-client seams only, never Runtime internals
- [x] Loads sessions created by CLI
- [x] Renders ACP updates and permission requests
- [x] Extension teardown closes transport/live handles without deleting durable Sessions

## Phase D — Desktop

- [x] Main process supervises Harness ACP subprocess
- [x] Renderer remains privilege-free
- [x] Loads sessions created by CLI/IDE
- [x] Permission UI maps to ACP permission choices only

## Phase E — Tool governance

- [x] Agent-triggerable side-effect inventory and boundary documentation
- [x] Static bypass verifier
- [x] CI gate

The verifier forbids model-facing tools from minting their own process/mutation path while preserving the repository's legitimate capability seams. Permission remains policy; Sandbox remains enforcement.

## Phase F — Sandbox coverage

- [ ] Process-capable consumer coverage audit
- [ ] Consistent `danger-full-access` / `workspace-write` / `read-only` semantics documented by consumer family
- [ ] Fail-closed coverage

## Explicitly deferred

No Redis, message bus, distributed lock, daemon, CRDT, generic policy engine, alternate ACP protocol, VM/container orchestration, or remote transport is introduced by this work.
