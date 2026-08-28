# Standalone Runtime implementation status

English | [中文](runtime-implementation-status.zh.md)

This branch implements the Standalone Agent Runtime plan as a sequence of small commits on one integration branch.

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
- [ ] JSONL restart integration test
- [ ] SQLite restart integration test
- [ ] Cross-client runtime portability E2E

## Phase B — Client separation

- [ ] CLI product-client path uses ACP
- [ ] CLI client path has no Agent Loop dependency
- [ ] CLI client path cannot invoke tools directly

## Phase C — IDE

- [ ] VS Code extension launches Harness ACP subprocess
- [ ] Loads sessions created by CLI
- [ ] Renders ACP updates and permission requests

## Phase D — Desktop

- [ ] Main process supervises Harness ACP subprocess
- [ ] Renderer remains privilege-free
- [ ] Loads sessions created by CLI/IDE

## Phase E — Tool governance

- [ ] Agent-triggerable side-effect inventory
- [ ] Static bypass verifier
- [ ] CI gate

## Phase F — Sandbox coverage

- [ ] Process-capable consumer coverage audit
- [ ] Consistent `danger-full-access` / `workspace-write` / `read-only` semantics
- [ ] Fail-closed coverage

## Explicitly deferred

No Redis, message bus, distributed lock, daemon, CRDT, generic policy engine, alternate ACP protocol, VM/container orchestration, or remote transport is introduced by this work.
