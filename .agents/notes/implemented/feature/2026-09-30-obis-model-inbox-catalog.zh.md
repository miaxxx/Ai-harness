# Agent Note: OBIS Model Inbox Catalog Tools

Status: implemented

[English](2026-09-30-obis-model-inbox-catalog.md) | 中文

## Problem

`ObisBridgeClient` 已经能通过 Kernel 集合 GET 列出有权的任务、审批与 skill。模型却只能在其他通道给出 id 之后调用 `obis_get_task` 和 `obis_get_skill`。Runtime MCP 与 Next Workspace 已经列出这些集合，因此 Harness Session 无法在工具注册表内发现同一收件箱。

## Decision

`createObisTools` 增加 `obis_list_tasks`、`obis_list_approvals` 和 `obis_list_skills`，作为现有客户端方法上的读取工具。`dsh-tool-obis` 注册同名工具。列出审批收件箱不会决定审批。列出 skill 不会启动 skill-runtime sandbox。execute、evaluate 与审批决定仍不进入模型注册表，见 [OHP P0 Client Surface Completeness](../architecture/2026-09-26-ohp-p0-client-surface.zh.md) 与 [OBIS Governed Workspace Execution](2026-09-07-obis-governed-workspace.zh.md)。

## Alternatives considered

**列表只留在 HTTP 客户端。** 拒绝，因为 `obis_get_task` 和 `obis_get_skill` 需要模型无法编造的 id，而 Workspace 已经为员工列出同一套 Kernel 集合。

**让 Harness 走 Runtime MCP 的 `list_entitled_*`，而不是 `/v1/harness/*`。** 拒绝，因为 native adapter 是 OHP Harness 客户端；第二套目录协议会拆散 entitlement 证据。

**在列表工具旁边再加 `obis_decide_approval`。** 拒绝，因为业务审批仍属于人类或产品运行时权威路径。

## Consequences

Harness Session 可以列出 Kernel 可见的任务、审批与 skill id，再读取单个任务或 skill 定义。列出审批不是决定权。列出 skill 不是 skill-runtime 执行。

## Testing

`packages/obis/bridge/tests/bridge.spec.ts` 把三个列表工具路由到 Kernel 集合 GET，并保持 execute、evaluate 与 decide 不在注册表中。`packages/obis/tool-obis/tests/tool-obis.spec.ts` 注册十个 native 工具。`packages/obis/tool-obis/tests/workspace-execution.spec.ts` 在已绑定的 AgentRun 上执行这些列表。

工具目录生成器挂载真实凭证与审批服务后注册 OBIS 插件，以获取十个工具的 Schema；生成过程不执行 Kernel 请求。Host 类型清单登记启动服务，将其接口归入凭证文档，并从模型运行时目录排除票据交换服务。
