# OBIS Harness Bridge

English | [中文](README.zh.md)

Reference AI Harness integration for **OHP 1.x**. This package is intentionally a protocol client and capability adapter; it does not copy OBIS policy, approval, ontology, Source-of-Truth or business workflow logic into Harness.

## Trust boundary

**AI proposes. Runtime decides.**

The model-facing surface contains governed context/query/knowledge/task/skill reads, entitled inbox and skill-catalog lists, and action proposal creation. It intentionally does **not** expose arbitrary production action execution as a model tool. Final execution is driven through OBIS confirmation/approval and re-enters OBIS ActionRuntime.

The HTTP client covers the OHP 1.0 P0 surface, including action evaluation, task listing, and business-approval inbox/decision. Evaluation and approval decisions stay off the model tool registry: evaluation is a policy preview, and approval decisions remain a human/runtime authority path. Entitled task, approval, and skill lists are model-visible reads over those same Kernel collection endpoints. `POST /v1/agent-runs` accepts optional `projectId` and `applicationModuleId` together; Kernel stamps that published module snapshot onto the run and later action/query calls stay inside it.

Full Harness session/reasoning history remains Harness-owned. The bridge sends only normalized run, proposal, usage and diagnostic metadata required for enterprise audit/trace. Public `HarnessInstallation`, `CapabilityLease`, and `AgentRunBinding` records omit tenant identifiers; Kernel still scopes by the authenticated session.

## Authentication

Provide a short-lived OBIS access token with `tokenProvider`. The client owns login, refresh and secure credential storage. Workspace handoff exchanges a single-use ticket in the Host; Desktop authenticates against OBIS Identity and keeps client credentials in the operating-system credential store. This package never persists credentials itself.

Business references serialize non-secret project, environment, Module, page and version selection into durable human text. Parsing validates the JSON fields and discards credential or permission claims. Display projection preserves the label. References convey user intent; publication, entitlement and execution authority remain Kernel-owned.

## Model Experience

### Governed capability definitions

#### What the model sees

Consumers expose `createObisTools` definitions for enterprise reads and action proposals. Approval decisions and final execution remain outside the model tool registry; the native adapter owns the prompt and tool registration.

#### Token effect

Tool names, arguments and returned enterprise records consume request tokens when a consumer registers these definitions. Access tokens and credential references are not model input.

#### KV Cache effect

Stable definitions can preserve a shared request prefix. Changing query results or proposal state changes the transcript suffix; the bridge does not control provider caching.

## Known Limitations and Deferred Work

- The bridge requires a reachable OBIS Kernel and a caller-owned token provider. It does not refresh credentials, render application pages, implement enterprise authorization, or execute skill definitions. Kernel evaluates current permissions on every operation.
