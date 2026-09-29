# Agent Note: OBIS AgentRun Module Binding

Status: implemented

English | [中文](2026-09-29-obis-agent-run-module-binding.zh.md)

## Problem

An OBIS AgentRun pinned deployment and artifact, and a Harness Session bound to one run, but the run was still workspace-wide for Query and Action names. A human who opened a published Module page in the launch overlay could then ask the same AgentRun to evaluate or propose capabilities from another module in the same project. Kernel entitlements already decide which modules are `visible`; that decision was not stamped onto the run at start.

## Decision

`POST /v1/agent-runs` accepts `projectId` and `applicationModuleId` together, or neither. When both are present, Kernel resolves the entitled published or canary module, stamps `projectId`, module id, module version, and the module's allowed action and query names onto the AgentRun, and persists that snapshot in `module_binding_json`. Later `proposeAction`, harness action evaluate/propose, and harness query evaluate/execute refuse names outside that snapshot with `AgentModuleScopeError` (HTTP 403). Unbound runs stay workspace-wide AI. Idempotent create compares the stamped module id and version.

Harness `dsh-tool-obis` sends the pair from config (both required when either is set) or, when config omits them, from Host `obisLaunch`: `snapshot().projectId` plus the Host-only `applicationModuleId()` set after a successful `module-page`. That id is not copied into RPC exchange results or `snapshot()`, so browser callers cannot select a module for AgentRun creation.

## Alternatives considered

**Bind the AgentRun to every entitled catalog row at exchange.** Rejected because a catalog can contain multiple modules; stamping the union would still allow cross-module actions. The page the human opened is the authority for that session's module scope.

**Put `boundModuleId` on `WorkspaceLaunchState` and return it from RPC `exchange`.** Rejected because the browser overlay must not choose AgentRun scope. Host keeps the id after `module-page`; Kernel remains the entitlement authority when the run is created.

**Require `mcp-developer` or a Builder token to create a module-bound run.** Rejected because the actor is the entitled Workspace user. Visibility is the same `visible` decision used for catalog and page GET.

## Consequences

A launch that never opens a published page still creates an unbound AgentRun. Opening a page and then calling OBIS tools stamps that module; actions and queries outside the snapshot fail closed even when the user's other entitlements would allow them. Changing a published module requires a new run; the snapshot does not follow later revisions.

## Testing

Kernel tests cover snapshot persistence, HTTP both-or-neither, 403 for draft/unentitled modules and out-of-scope action/query, and idempotency mismatch. Harness tests cover Host-only `applicationModuleId()`, tool-obis config vs launch duck-typing, and bridge `createAgentRun` / `bindObisRun` request bodies.
