# guard/ — agent 行为 guard 家族

[English](README.md) | 中文

行为 guard 插件约束完成流程、监视无效模式，并强制执行单次调用预算。guard 是核心服务和扩展点的自包含消费方，而非可替换能力。

| 包 | 职责 | ctx key |
|---|---|---|
| [`delivery-quality-policy/`](delivery-quality-policy/README.zh.md) | 全局最终状态验收与修复循环策略 | 向 `ctx.systemPrompt` 贡献段落 |
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.zh.md) | 针对重复工具调用的建议性提醒 | 监听工具和 agent 事件 |
| [`timeout-policy/`](timeout-policy/README.zh.md) | 以部署策略形式设置单次工具调用截止时间 | 注册 `tools/execute` 监听器 |

产物验收由稳定系统提示词段落与产品内按产物分流的验证 Skill 共同提供。提醒作为 `additionalContexts` 随 `tools/post-execute` 决策传递，并作为来源于插件的 `user/message` 事件追加记录（[工具](../../docs/subsystems/tools.zh.md)）；跨 `dsh-timeout`、能力终止与本策略层的超时拆分记录在[超时库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.zh.md)。
