# `@deepseek-ai/dsh-computer-macos`

[English](README.md) | 中文

`dsh-computer` 的 macOS Provider。它通过固定 JXA 操作调用辅助功能 API，仅在请求快照像素时调用 `screencapture`。macOS 必须授予辅助功能权限；截图还需要屏幕录制权限。截图捕获会遵循活动轮次的取消信号。模型不会提供可执行 JXA。

## Model Experience

通过 `@deepseek-ai/dsh-tool-computer` 间接可见。

#### KV Cache effect

Provider 自身不增加上下文；持久化结果与缓存行为由消费工具负责。

## Known Limitations and Deferred Work

- **Accessibility coverage** — 没有可用辅助功能标签的自定义控件需要未来的视觉坐标兜底。
