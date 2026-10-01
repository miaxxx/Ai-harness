# OBIS Harness Bridge

[English](README.md) | 中文

此包提供 OHP 1.x 协议客户端与能力适配器。企业策略、审批、本体、权威数据和业务工作流由 OBIS 实现。

## 信任边界

模型可读取受控上下文、查询、知识、任务、审批收件箱和技能目录，也可创建 Action 提案。模型工具不提供任意生产执行入口；最终执行经过人工确认和 OBIS ActionRuntime。

HTTP 客户端支持 Action 评估、任务列表、业务审批列表与决策。评估和审批决策不注册为模型工具；审批决策属于人工或运行时权限。`POST /v1/agent-runs` 的 `projectId` 与 `applicationModuleId` 必须同时提供，Kernel 将已发布 Module 快照绑定到 Run，后续查询和操作受其限制。

完整 Harness 会话和推理历史由 Harness 保存。Bridge 仅传递企业审计所需的 Run、提案、用量和诊断元数据。公开的 `HarnessInstallation`、`CapabilityLease` 和 `AgentRunBinding` 不包含租户标识；Kernel 使用认证会话确定租户。

## 认证

通过 `tokenProvider` 提供短期 OBIS 访问令牌。调用客户端负责登录、刷新和安全存储。Workspace 在 Host 中交换一次性票据；Desktop 使用 OBIS Identity 登录，将客户端凭证保存在操作系统凭证存储中。本包不持久化凭证。

## Model Experience

### Governed capability definitions

#### What the model sees

消费者通过 `createObisTools` 提供企业读取与 Action 提案定义。审批决策和最终执行不进入模型工具目录；原生适配器负责提示词和工具注册。

#### Token effect

消费者注册这些定义后，工具名、参数和企业返回记录占用请求 token。访问令牌与凭证引用不进入模型输入。

#### KV Cache effect

稳定的定义可保留共同请求前缀。查询结果和提案状态改变会话后缀；Bridge 不控制模型提供商的缓存。

## Known Limitations and Deferred Work

- Bridge 需要可访问的 OBIS Kernel 和调用方提供的令牌。它不刷新凭证、不渲染页面、不实现企业授权，也不执行技能定义。Kernel 每次操作重新判权。

业务引用将非机密的项目、环境、Module、页面和版本选择写入持久用户文本。解析校验 JSON 字段并丢弃凭证或权限声明；显示投影保留标签。引用表达用户意图，发布状态、授权和执行权限仍由 Kernel 决定。
