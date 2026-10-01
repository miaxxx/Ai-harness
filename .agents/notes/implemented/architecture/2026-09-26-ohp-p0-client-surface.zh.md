# Agent Note: OHP P0 Client Surface Completeness

Status: implemented

[English](2026-09-26-ohp-p0-client-surface.md) | 中文

## Problem

OHP 1.0 的 README 与 Kernel 已经提供动作预检、任务列表以及业务审批收件箱/决定。Harness bridge 客户端原先只实现其中一部分路径，因此协议覆盖与 P0 合同漂移，而模型工具注册表仍然正确地只到提案。

## Decision

`ObisBridgeClient` 补齐剩余的 OHP 1.0 P0 HTTP 操作：`evaluateAction`、`listTasks`、`listApprovals` 与 `decideApproval`。面向模型的 `createObisTools` 仍然不包含 execute、evaluate 与审批决定工具。有权的任务、审批与 skill 列表作为读取工具走同一套集合 GET；预检仍是策略预览；审批决定仍属于人类或产品运行时权威路径。

## Alternatives considered

**把 `obis_evaluate_action` 和 `obis_decide_approval` 加入模型注册表。** 拒绝，因为预检不是生产变更，业务审批也不能变成由 prompt 选择的工具。

**让客户端保持不完整，由 Desktop 直接调用 Kernel 路径。** 拒绝，因为 OHP 是共享合同；第二条未文档化的 HTTP 客户端会拆散兼容性证据。

## Consequences

包测试钉住这些额外客户端路径。`createObisTools` 把有权的任务、审批与 skill 列表作为读取工具暴露出来；execute、evaluate 与审批决定仍不进入模型工具注册表。这些列表工具见 [OBIS Model Inbox Catalog Tools](../feature/2026-09-30-obis-model-inbox-catalog.zh.md)。Kernel OpenAPI 现在列出 README 已命名的任务列表与审批操作。托管 runner 上的 Stage A 验证仍不在本变更范围内。
