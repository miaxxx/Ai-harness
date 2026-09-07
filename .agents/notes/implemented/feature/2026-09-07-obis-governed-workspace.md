# Agent Note: OBIS Governed Workspace Execution

Status: implemented

## Problem

OBIS enterprise tools originally accepted a static `runId` and capability lease. That was sufficient for bridge validation but not for a product workspace: a Harness Session could ask enterprise questions without a durable OBIS work identity, the model had to supply optimistic `AgentRun.version`, and an action proposal stopped before the product's human-confirmation and final OBIS execution path.

## Decision

`dsh-tool-obis` binds enterprise work at the Harness Session boundary without changing Agent Loop. On the first OBIS tool call, the adapter uses the Session's first durable human prompt as the OBIS goal, idempotently creates or resumes one `AgentRun`, attaches the Harness Session id, and retains the run-scoped capability lease returned by OBIS for that live Session.

The model-facing surface remains proposal-only. `obis_propose_action` creates a governed OBIS proposal and the bridge obtains the current run version from OBIS rather than asking the model to manage it. When the returned run autonomy permits execution and OBIS policy allowed the proposal, the native adapter asks `ctx.approval` inside the same tool turn. Only `allowed-once` causes the adapter—not the model—to call the non-model-facing bridge method for `/v1/harness/proposals/{id}/execute`. OBIS then re-evaluates its own policy, business approval and ActionRuntime rules.

The ordinary Harness tool result contains the proposal, human-confirmation outcome and final OBIS execution result. Existing Session logging therefore remains the product transcript and replay source; OBIS receives normalized enterprise execution facts rather than Harness reasoning.

## Alternatives considered

**Expose `obis_execute_action` to the model.** Rejected because it would turn human confirmation into prompt convention and enlarge the model's mutation authority. The adapter deliberately keeps proposal execution outside the model tool registry.

**Implement a second agent/workflow loop in OBIS.** Rejected because Harness already owns planning, sessions, tool execution and interaction. OBIS remains the enterprise authority and execution runtime.

**Require callers to inject a static `runId`, lease and version into every Session.** Retained only as an explicit managed/diagnostic override. It does not provide product-grade resume semantics and makes the model or UI coordinate state that OBIS already owns.

## Consequences

One Harness Session maps to one durable OBIS AgentRun and task. Session resume reuses the same deterministic create key and opaque Harness Session id. Read-only and recommendation autonomy cannot gain proposal-execution authority: a capability lease can only narrow authority, and the adapter only requests human execution confirmation for run autonomy modes that permit execution. A missing approval answerer fails closed. Business approval remains distinct from Harness confirmation and can still leave the OBIS action in `approval-required` state.
