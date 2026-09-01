# `@deepseek-ai/dsh-computer-macos`

[English](README.md) | 中文

`dsh-computer` 的 macOS Provider。它通过受限深度/节点数的递归 Accessibility 遍历观察原生应用，只执行固定的 JXA/CoreGraphics 操作，并且仅在全桌面视觉观察时调用 `screencapture`。macOS 必须授予辅助功能权限；截图还需要屏幕录制权限。观察与捕获都会遵循活动轮次的取消信号。模型不会提供可执行 JXA。

Provider 支持原生 `app` 与 `desktop` 目标。应用观察以语义/辅助功能为先，并返回仅属于当前 observation 的元素 id。支持的变更包括语义化元素操作，以及受限的坐标点击/拖拽和桌面滚动；每次变更后都会重新获取新的辅助功能观察。当窗口级像素捕获不可用时，Provider 返回 `WINDOW_UNAVAILABLE`，不会把全桌面截图冒充应用图像。

平台失败通过稳定的 Computer 错误词汇暴露，包括 `COMPUTER_PERMISSION_REQUIRED`、`TARGET_NOT_FOUND`、`WINDOW_UNAVAILABLE`、`ELEMENT_EXPIRED`、`ACTION_UNSUPPORTED` 与 `CAPTURE_FAILED`。

## Model Experience

通过 `@deepseek-ai/dsh-tool-computer` 间接可见。

#### KV Cache effect

Provider 自身不增加上下文；模型可见观察、短生命周期状态与 diff 渲染由消费工具负责。

## Known Limitations and Deferred Work

- **Window-scoped visual capture** — 在存在真实可靠的窗口级捕获实现之前，本 Provider 刻意不宣称支持应用/窗口截图。应用视觉任务可以切换到合适的其他 Provider；如果辅助功能状态已经足够，则保持语义路径即可。
- **Accessibility coverage** — 缺少有效辅助功能语义的自定义控件可能需要工具的坐标兜底；此类坐标操作应由最新视觉证据驱动，而不是复用旧截图。
