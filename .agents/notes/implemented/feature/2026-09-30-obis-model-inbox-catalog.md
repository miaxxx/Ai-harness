# Agent Note: OBIS Model Inbox Catalog Tools

Status: implemented

English | [中文](2026-09-30-obis-model-inbox-catalog.zh.md)

## Problem

`ObisBridgeClient` already listed entitled tasks, approvals, and skills through Kernel collection GET. The model could only `obis_get_task` and `obis_get_skill` after some other channel supplied the id. Runtime MCP and Next Workspace already list those collections, so a Harness Session could not discover the same inbox without leaving the tool registry.

## Decision

`createObisTools` adds `obis_list_tasks`, `obis_list_approvals`, and `obis_list_skills` as reads over the existing client methods. `dsh-tool-obis` registers the same names. Listing an approval inbox does not decide an approval. Listing skills does not start a skill-runtime sandbox. Execute, evaluate, and approval-decision stay off the model registry, as in [OHP P0 Client Surface Completeness](../architecture/2026-09-26-ohp-p0-client-surface.md) and [OBIS Governed Workspace Execution](2026-09-07-obis-governed-workspace.md).

## Alternatives considered

**Keep lists on the HTTP client only.** Rejected because `obis_get_task` and `obis_get_skill` need ids the model cannot invent, and Workspace already lists the same Kernel collections for employees.

**Route Harness through Runtime MCP `list_entitled_*` instead of `/v1/harness/*`.** Rejected because the native adapter is an OHP Harness client; a second catalog protocol would split entitlement evidence.

**Add `obis_decide_approval` beside the list tool.** Rejected because business approval remains a human or product-runtime authority path.

## Consequences

A Harness Session can list Kernel-visible task, approval, and skill ids, then read one task or skill definition. Approval listing is not decision authority. Skill listing is not skill-runtime execution.

## Testing

`packages/obis/bridge/tests/bridge.spec.ts` routes the three list tools to Kernel collection GET and keeps execute, evaluate, and decide off the registry. `packages/obis/tool-obis/tests/tool-obis.spec.ts` registers the ten native tools. `packages/obis/tool-obis/tests/workspace-execution.spec.ts` executes the lists through a bound AgentRun.

The tool catalog mounts credential and approval services before registering the OBIS plugin to collect its ten schemas without executing Kernel requests. The Host type manifest includes the launch service, documents its API under credentials, and excludes ticket exchange from the model runtime catalog.
