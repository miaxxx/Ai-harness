# Agent Note: OHP P0 Client Surface Completeness

Status: implemented

English | [中文](2026-09-26-ohp-p0-client-surface.zh.md)

## Problem

OHP 1.0 README and Kernel already expose action evaluation, task listing, and business-approval inbox/decision. The Harness bridge client only implemented a subset of those paths, so protocol coverage drifted from the P0 contract while the model tool registry stayed correctly proposal-only.

## Decision

`ObisBridgeClient` covers the remaining OHP 1.0 P0 HTTP operations: `evaluateAction`, `listTasks`, `listApprovals`, and `decideApproval`. Model-facing `createObisTools` still omits execute, evaluate, and approval-decision tools. Entitled task, approval, and skill lists are model-visible reads over the same collection GET paths; evaluation remains a policy preview, and approval decisions remain a human or product-runtime authority path.

## Alternatives considered

**Add `obis_evaluate_action` and `obis_decide_approval` to the model registry.** Rejected because evaluation is not a production mutation, and business approval must not become a prompt-chosen tool.

**Leave the client incomplete and let Desktop call Kernel paths directly.** Rejected because OHP is the shared contract; a second undocumented HTTP client would split compatibility evidence.

## Consequences

Package tests pin the extra client paths. `createObisTools` exposes entitled task, approval, and skill lists as reads; execute, evaluate, and approval-decision remain off the model registry. Those list tools are in [OBIS Model Inbox Catalog Tools](../feature/2026-09-30-obis-model-inbox-catalog.md). Kernel OpenAPI now lists the same task-list and approval operations the README already named. Hosted-runner Stage A verification remains outside this change.
