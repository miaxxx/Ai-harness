# Agent Note: OBIS Governed Workspace Execution

Status: implemented

## Problem

OBIS 企业工具最初接受静态 `runId` 和 capability lease。这足以验证 Bridge，但不足以支撑真实产品工作区：Harness Session 可以在没有持久 OBIS 工作身份的情况下查询企业信息，模型还需要自己提供乐观并发用的 `AgentRun.version`，而动作链只停留在 proposal，尚未进入产品的人类确认与最终 OBIS 执行路径。

## Decision

`dsh-tool-obis` 在 Harness Session 边界绑定企业工作，不修改 Agent Loop。第一次调用 OBIS 工具时，adapter 使用 Session 中第一条持久化的人类 prompt 作为 OBIS goal，以幂等方式创建或恢复一个 `AgentRun`，绑定 Harness Session id，并在当前 Session 生命周期内保存 OBIS 返回的 run-scoped capability lease，供之后的治理型调用使用。

模型可见的能力仍然只到 proposal。`obis_propose_action` 创建受治理的 OBIS proposal，Bridge 直接从 OBIS 获取当前 run version，而不要求模型管理它。当返回的 run autonomy 允许执行，并且 OBIS policy 允许该 proposal 时，native adapter 在同一个 tool turn 内通过 `ctx.approval` 请求人类确认。只有 `allowed-once` 才允许 adapter——而不是模型——调用非模型可见的 Bridge 方法访问 `/v1/harness/proposals/{id}/execute`。随后 OBIS 仍会重新进入自己的 policy、业务 approval 与 ActionRuntime 规则。

普通 Harness tool result 会包含 proposal、人类确认结果和最终 OBIS execution result。因此既有 Session log 继续作为产品 transcript 与 replay 的 Source of Truth；OBIS 接收的是标准化企业执行事实，而不是 Harness reasoning。

## Alternatives considered

**向模型暴露 `obis_execute_action`。** 拒绝，因为这会把人类确认退化为 prompt 约定，并扩大模型的 mutation authority。adapter 明确把 proposal execution 保留在模型工具注册表之外。

**在 OBIS 内实现第二套 agent/workflow loop。** 拒绝，因为 Harness 已经拥有 planning、session、tool execution 和 interaction。OBIS 继续只承担企业 authority 与 execution runtime。

**要求调用方为每个 Session 静态注入 `runId`、lease 和 version。** 仅保留为显式 managed/diagnostic override。它无法提供产品级 resume semantics，并会迫使模型或 UI 协调本应由 OBIS 持有的状态。

## Consequences

一个 Harness Session 对应一个持久 OBIS AgentRun 和 task。Session resume 会复用相同的确定性 create key 和 opaque Harness Session id。read-only 与 recommend autonomy 不能因此获得 proposal execution authority：capability lease 只能缩小权限，而 adapter 只会对本身允许执行的 run autonomy 请求人类执行确认。没有 approval answerer 时默认 fail closed。业务 approval 与 Harness confirmation 保持两个独立门槛，OBIS 动作仍可能停留在 `approval-required`，不会被误认为成功执行。
