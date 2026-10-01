# @deepseek-ai/dsh-tool-obis

[English](README.md) | 中文

原生 Harness 插件通过工具目录注册 `obis_context`、`obis_query`、`obis_get_object`、`obis_search_knowledge`、`obis_propose_action`、`obis_list_tasks`、`obis_get_task`、`obis_list_approvals`、`obis_list_skills` 和 `obis_get_skill`。任务和审批工具只读取 Kernel 收件箱，不做审批决策；技能工具只读取当前部署的技能目录与定义，不启动技能沙箱。本插件不修改 Agent Loop，也不在本地实现企业策略、审批、本体或生产写操作。

配置仅保存凭证引用，每次操作通过 `ctx.credentials` 获取短期令牌。常规配置使用会话中第一条持久化人工消息创建或恢复一个 OBIS AgentRun，关联 Harness Session id，并使用 Run 的能力租约。`installationId` 用于注册设备的绑定租约；`runId` 和 `capabilityLease` 支持受管理或诊断组合的显式覆盖。`projectId` 和 `applicationModuleId` 必须同时配置，将已发布 Module 快照绑定到 Run。未配置时，成功调用 `module-page` 后从可选 Host `obisLaunch` 获取同一对标识。未绑定 Module 的 Run 使用 Workspace AI 范围。

`obis_propose_action` 创建企业提案，不向模型提供执行工具。OBIS 允许提案且 Run 自主级别允许执行时，适配器通过 `ctx.approval` 请求同一轮中的人工确认。只有 `allowed-once` 才提交到 `/v1/harness/proposals/{id}/execute`；OBIS 再次检查当前策略、业务审批、ActionRuntime 和幂等性。拒绝、取消或无法确认时不执行；需要业务审批时保留 `approval-required` 状态。

模型不维护 `AgentRun.version`。Bridge 在创建提案前读取 Run 状态，确认执行时使用提案返回的版本。提案、确认和执行结果记录在普通 Harness Session 日志中，回放和恢复不需要第二套会话存储。

`obis_next_run_event` 使用后台持有的 Run 租约读取一个公开 SSE 事件后关闭连接；`afterId` 可从上次事件继续。`eventReadTimeoutMs` 配置最大等待时间，默认 5000 毫秒。超时返回空事件，用户取消及服务端拒绝保留为错误；返回值不包含租约。读取事件不会完成任务。

## Model Experience

### Enterprise guidance

#### What the model sees

`tool:obis` 提示要求企业读取和提案经过 OBIS，并区分提案与已完成执行。

##### Guidance text

```markdown
OBIS is the enterprise authority. Use obis_* tools for enterprise facts and governed operations.
The Harness Session is bound to one durable OBIS AgentRun before enterprise tools execute; OBIS owns its task, deployment pin, policy and capability lease.
obis_propose_action creates a governed proposal. When the run permits execution, Harness asks the human for one-shot confirmation and only the adapter may submit that proposal back to OBIS for final policy, business-approval and ActionRuntime execution.
Never describe a proposal as executed unless the tool result contains an OBIS execution result with status executed.
Use named governed queries for enterprise object reads; do not infer missing enterprise facts from local files or model memory.
obis_list_tasks, obis_list_approvals, and obis_list_skills list Kernel-visible inbox and catalog ids for this deployment. They do not decide approvals or start a skill-runtime.
obis_get_skill loads a Kernel IR skill definition for the current deployment. Follow that definition; do not invent skill steps or start a local skill-runtime.
```

#### Token effect

挂载插件的会话中，固定提示进入每次模型请求。企业结果占用会话 token；秘密保存在 Host 凭证存储中。

#### KV Cache effect

提示在各次调用间保持稳定。组合提示段落和工具结果改变可能缩短可复用前缀；缓存行为由模型提供商控制。

### Tool schemas

#### What the model sees

[OBIS 工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-obis) 列出十个注册工具和参数。结果包含受控读取、提案决策，以及人工确认后的执行状态。

#### Token effect

注册的 `obis_*` 定义占用工具 Schema token。结果大小取决于查询、收件箱或技能响应；数量限制减少返回记录。

#### KV Cache effect

稳定工具定义可复用请求前缀。记录的结果与确认状态改变会话后缀。

## Known Limitations and Deferred Work

工具调用前，Host 管理的能力租约到期后通过同一个 Run 与 Harness Session 重新附着续租；并发调用共享请求。服务端返回过期租约时，在发送业务操作前拒绝执行。显式配置的租约仍由签发方管理，缓存不替换它；服务端拒绝不会触发业务操作重试。

- 插件需要 OBIS Kernel、凭证提供者和审批服务。缺少或取消人工确认时提案不执行；Harness 确认后业务审批仍可能待处理。技能工具仅读取定义，不启动技能沙箱；登录、刷新和应用渲染由客户端插件负责。

持久用户业务引用在工具执行前选择 Module。适配器校验 `workspaceProjectId` 与环境，为所选 Module 版本创建独立 Run，并保留原 Harness Session 编号用于附着。后续回合沿用最新用户选择。`referenceAutonomy` 默认为只读；human-approved 启用已有的提议、确认与执行流程。单个提示词不能混合不同 Module 版本或作用域；发布版本变化后，引用在受控操作前拒绝。
