# `@deepseek-ai/dsh-computer`

[English](README.md) | 中文

与 Provider 无关的本机电脑控制能力。`ctx.computer` 选择一个可用 Provider，并提供受限的应用发现、检查和操作。检查元素 id 会在下一次检查或操作后失效。

Desktop 组合在 `DSH_BROWSER_CDP_URL` 指向本机端点时选择 Chromium DevTools Provider，否则选择 macOS 辅助功能 Provider。组合可以通过 `provider` 配置字段固定其他 Provider。

## Model Experience

通过 `@deepseek-ai/dsh-tool-computer` 间接可见。

#### KV Cache effect

Provider 注册表自身不增加上下文；持久化结果与缓存行为由消费工具负责。

## Known Limitations and Deferred Work

- **Provider availability** — 本包不拥有平台实现；部署需挂载合适的 Provider。
