# Agent Note: OBIS Cross-Repository Compatibility

Status: implemented

## Problem

OBIS 与 AI Harness 是通过 OHP 连接、分别进行版本管理的两个系统。包内测试只能证明双方各自成立，无法证明真实 Harness Session 能够向真实 OBIS Kernel 完成认证、获得 run-scoped authority、跨越持久化边界恢复，并在不破坏职责边界的情况下执行受治理的企业写操作。

同时，OBIS 仓库当前的 GitHub Actions runner 存在外部基础设施故障：job 可能在任何 step 启动前直接结束。因此如果只依赖 OBIS 仓库自己的 CI 信号，跨仓协议边界就无法获得稳定的可执行证据。

## Decision

AI Harness 维护一条跨仓 P0 compatibility workflow。它会 checkout 指定的 `miaxxx/obis-dev` ref，并在当前可正常工作的 Harness GitHub Actions runner 上，配合 PostgreSQL 16 运行真实的 candidate pair。

强制 P0 candidate 单元会针对同一个 PostgreSQL 数据库两次启动真实 OBIS Kernel。测试使用本地签名 OIDC provider 提供确定性的登录过程，不依赖外部身份服务网络。企业状态通过 OBIS Pack compiler 和 deployment API 建立；进入认证阶段后，只使用 OHP 1.0 与 run-scoped Capability Lease。

测试通过 Harness `ToolRuntime` 驱动原生 `tool-obis` plugin，而不是另造 Agent Loop。覆盖 context、governed query、skill discovery、proposal creation、Harness 原生 one-shot human approval、adapter 内部 proposal execution、task state、restart/resume、response-loss replay、policy denial 与 protocol-version rejection。同时检查模型可见 registry 中不存在 `obis_execute_action`。

第二个 matrix 单元把 `OBIS main × Harness candidate` 明确记录为 expected incompatible，因为 OHP 1.0 当前仍只存在于 P0 分支。一旦 main 获得 OHP contract，该单元会主动失败，迫使维护者把它升级为 full suite，而不是长期保留已经过时的 expected-failure。正式 release ref 尚不存在时，不伪造 release/current 与 release/previous 的绿色结果。

workflow 会在相关 Harness 代码变化、手动 dispatch 和每日 schedule 时运行。这样即使普通仓库 push 事件无法使用默认 token 直接触发另一个仓库的 workflow，OBIS 独立发生的变化仍会被周期性发现。

## Alternatives considered

**只在 OBIS 仓库运行 matrix。** P0 阶段拒绝，因为当前 OBIS Actions 基础设施可能在 step 运行前失败，无法稳定提供集成证据。Harness-hosted lane 并不宣称修好了 OBIS 仓库 runner；它只是为同一份源码提供独立可执行环境。

**Mock OBIS HTTP service。** 拒绝，因为那只是在重复测试 Bridge contract。真正的 matrix 必须穿过 Kernel、compiler、policy runtime、AgentRun/Task persistence、Capability Lease validation 与 ActionRuntime。

**为了简化 E2E 给模型暴露 execute tool。** 拒绝，因为这会破坏产品 authority boundary。live test 使用和生产组合一致的 human approval → adapter-internal execute 路径。

**对尚不可用的 main/release 组合直接记绿色。** 拒绝，因为 compatibility evidence 必须清楚区分 supported pair、expected incompatibility 与尚不存在的 ref。

## Consequences

P0 candidate pair 现在拥有一条跨越 repository、process、authentication、protocol、persistence、policy、approval 与 execution 边界的可执行 acceptance lane。network interruption 场景特别验证：OBIS 已提交请求、但客户端丢弃响应之后，使用相同 idempotency key 重试仍返回同一份已提交状态。

这条 lane 比包内测试更重，并依赖 PostgreSQL 和两个仓库均可 checkout。它不会修复或替代 OBIS 仓库自身的 CI 基础设施；即使 cross-repo lane 绿色，也不能把它描述成“OBIS 仓库本地 PostgreSQL job 已经 CI 通过”。
