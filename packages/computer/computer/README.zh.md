# `@deepseek-ai/dsh-computer`

[English](README.md) | 中文

与 Provider 无关的本机电脑控制 Runtime。`ctx.computer` 按目标类型（`app`、`browser-tab`、`desktop`）聚合可用 Provider，将每次观察/操作路由到支持该目标的 Provider，并在每次操作后返回新的受限观察。元素 id 只属于一次观察；下一次操作或观察之后必须视为失效。

多个 Provider 可以在同一组合中共存。`provider` 配置字段只在“同一种目标类型有多个可用 Provider”时作为歧义决胜，不会全局隐藏其他目标类型的 Provider。因此 Desktop 在两个 Provider 都可用时，可以同时暴露 macOS 原生目标和 Chromium 标签页。

Runtime contract 将语义化辅助功能状态与视觉捕获分离。Provider 必须如实报告捕获范围和稳定的 Computer 错误；当应用/窗口级捕获不可用时，不得悄悄替换成其他目标或用全桌面像素冒充应用窗口。

## Model Experience

通过 `@deepseek-ai/dsh-tool-computer` 间接可见。

#### KV Cache effect

Provider 注册表自身不增加模型上下文。模型可见的观察、短生命周期的按 Agent 状态和 diff 渲染由消费工具负责。

## Known Limitations and Deferred Work

- **Provider availability** — 本包不包含平台实现；部署需要挂载合适的 Provider。
- **No universal locator layer** — 语义 id 刻意限定在一次观察内；OCR/CV 元素定位不属于本 Runtime contract。
