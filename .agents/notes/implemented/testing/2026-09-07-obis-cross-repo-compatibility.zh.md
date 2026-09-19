# Agent Note: OBIS Cross-Repository Compatibility

Status: implemented

## Problem

OBIS 与 AI Harness 是通过 OHP 连接、分别进行版本管理的两个系统。包内测试只能证明双方各自成立，无法证明真实 Harness Session 能够向真实 OBIS Kernel 完成认证、获得 run-scoped authority、跨越持久化边界恢复，并在不破坏职责边界的情况下执行受治理的企业写操作。

OBIS 仓库是私有仓库，因此 AI Harness workflow 获得的普通 `GITHUB_TOKEN` 无权 checkout 它。与此同时，OBIS 仓库当前的 GitHub Actions 基础设施还有一个独立的外部故障：job 可能在任何 step 启动前直接结束。跨仓证据必须同时保留这两个事实，不能把仓库可见性问题或 runner provisioning 问题错误归类为 OHP compatibility failure。

## Decision

真实 P0 compatibility matrix 由私有 `miaxxx/obis-dev` 仓库持有。该仓库自己的 repository-scoped `GITHUB_TOKEN` 可以读取选定的 OBIS ref，而公开的 `miaxxx/Ai-harness` candidate 可以直接 checkout，不需要为了 matrix 给 Harness 配置长期跨仓凭证。AI Harness 继续持有可执行 E2E scenario source 和 native-adapter 行为测试，因为这些场景实际驱动 Harness `ToolRuntime` 与 `tool-obis`；OBIS 负责维护组合两个仓库的 workflow。

强制 P0 candidate 单元会针对同一个 PostgreSQL 数据库两次启动真实 OBIS Kernel。测试使用本地签名 OIDC provider 提供确定性的登录过程，不依赖外部身份服务网络。企业状态通过 OBIS Pack compiler 和 deployment API 建立；进入认证阶段后，只使用 OHP 1.0 与 run-scoped Capability Lease。

测试通过 Harness `ToolRuntime` 驱动原生 `tool-obis` plugin，而不是另造 Agent Loop。覆盖 context、governed query、skill discovery、proposal creation、Harness 原生 one-shot human approval、adapter 内部 proposal execution、task state、restart/resume、response-loss replay、policy denial 与 protocol-version rejection。同时检查模型可见 registry 中不存在 `obis_execute_action`。

第二个 matrix 单元把 `OBIS main × Harness candidate` 明确记录为 expected incompatible，因为 OHP 1.0 当前仍只存在于 P0 分支。一旦 main 获得 OHP contract，该单元会主动失败，迫使维护者把它升级为 full suite，而不是长期保留已经过时的 expected-failure。正式 release ref 尚不存在时，不伪造 release/current 与 release/previous 的绿色结果。

OBIS-owned workflow 会在相关 OBIS 代码变化、手动 dispatch 和每日 schedule 时运行。只有 workflow 的 step 实际执行时，绿色结果才是有效的 cross-repository evidence；如果已知的 OBIS runner provisioning 故障让 job 在 step 之前终止，结果仍然属于外部 CI blocker，而不是产品失败。

## Alternatives considered

**在 AI Harness 中使用普通 `GITHUB_TOKEN` checkout 私有 OBIS 仓库。** 真实 CI 已证明不可行：GitHub 返回 `Repository not found`，因为 repository-scoped workflow token 不会自动拥有另一个私有仓库的读取权限。

**仅为了 matrix 在 AI Harness 中保存长期 cross-repository PAT。** P0 阶段拒绝，因为把组合 workflow 放在 OBIS 就能完成同样工作，不需要新增一套 secret 生命周期。如果未来必须把 matrix ownership 移出 OBIS，可以再考虑专用 GitHub App 或组织级 reusable-workflow credential。

**Mock OBIS HTTP service。** 拒绝，因为那只是在重复测试 Bridge contract。真正的 matrix 必须穿过 Kernel、compiler、policy runtime、AgentRun/Task persistence、Capability Lease validation 与 ActionRuntime。

**为了简化 E2E 给模型暴露 execute tool。** 拒绝，因为这会破坏产品 authority boundary。live test 使用和生产组合一致的 human approval → adapter-internal execute 路径。

**对尚不可用的 main/release 组合直接记绿色。** 拒绝，因为 compatibility evidence 必须清楚区分 supported pair、expected incompatibility 与尚不存在的 ref。

## Consequences

candidate matrix 现在拥有权限模型正确的执行位置：OBIS 提供私有源码访问，Harness 提供公开执行引擎和 E2E scenario code。network interruption 场景会验证 OBIS 已提交请求、客户端丢弃响应之后，使用相同 idempotency key 重试仍返回同一份已提交状态。

这条 lane 比包内测试更重，并依赖 PostgreSQL 和两个仓库均可 checkout。它不会修复 OBIS 仓库自身的 runner provisioning 问题；一个从未启动 step 的 job 不能被报告为通过。同样，Harness package/Host CI 绿色也不能被描述成“OBIS 仓库本地 PostgreSQL job 已经 CI 通过”。
