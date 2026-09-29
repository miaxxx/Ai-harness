# Agent Note: OBIS AgentRun Module Binding

Status: implemented

[English](2026-09-29-obis-agent-run-module-binding.md) | 中文

## Problem

OBIS AgentRun 已经钉住 deployment 与 artifact，Harness Session 也绑定到一个 run，但该 run 对 Query 和 Action 名称仍然是整个 workspace。人在 launch overlay 里打开某个已发布 Module 页面之后，同一个 AgentRun 仍可以评估或提议同一项目里另一个模块的能力。Kernel entitlements 已经决定哪些模块 `visible`；这个决定没有在 run 创建时盖到快照上。

## Decision

`POST /v1/agent-runs` 要么同时接受 `projectId` 与 `applicationModuleId`，要么两者都不接受。两者都在时，Kernel 解析有权的 published 或 canary 模块，把 `projectId`、module id、module version 以及该模块允许的 action 与 query 名称盖到 AgentRun 上，并持久化到 `module_binding_json`。之后的 `proposeAction`、harness action evaluate/propose、harness query evaluate/execute 若使用快照之外的名称，会抛 `AgentModuleScopeError`（HTTP 403）。未绑定的 run 仍是整个 workspace 的 AI。幂等创建比较盖上的 module id 与 version。

Harness `dsh-tool-obis` 从 config 发送这一对（只给其中一个会拒绝），config 省略时则从 Host `obisLaunch` 读取：`snapshot().projectId` 加上 Host 独有的 `applicationModuleId()`（一次成功的 `module-page` 之后才有）。该 id 不会复制进 RPC exchange 结果或 `snapshot()`，因此浏览器调用方不能为 AgentRun 创建自选模块。

## Alternatives considered

**在 exchange 时把 AgentRun 绑定到 catalog 里每一行有权模块。** 拒绝，因为 catalog 可以包含多个模块；盖上并集仍允许跨模块 action。人打开的页面才是该 session 模块范围的权威。

**把 `boundModuleId` 放进 `WorkspaceLaunchState` 并从 RPC `exchange` 返回。** 拒绝，因为浏览器 overlay 不得选择 AgentRun scope。Host 在 `module-page` 之后保存该 id；创建 run 时 entitlement 仍由 Kernel 裁决。

**要求 `mcp-developer` 或 Builder token 才能创建模块绑定的 run。** 拒绝，因为 actor 是有权的 Workspace 用户。可见性与 catalog、page GET 使用同一个 `visible` 决定。

## Consequences

从未打开已发布页面的 launch 仍创建未绑定 AgentRun。打开页面后再调用 OBIS 工具会盖上该模块；即使用户对其他模块也有权，快照之外的 action 与 query 也会失败。已发布模块变更后需要新的 run；快照不跟随后续 revision。

## Testing

Kernel 测试覆盖快照持久化、HTTP 成对字段、draft/无权模块与越权 action/query 的 403，以及幂等冲突。Harness 测试覆盖 Host 独有的 `applicationModuleId()`、tool-obis 的 config 与 launch duck-type，以及 bridge `createAgentRun` / `bindObisRun` 请求体。
