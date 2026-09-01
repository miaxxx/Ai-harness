# computer/：受控本机 Computer Use

[English](README.md) | 中文

本家族为本机浏览器标签页、原生应用和完整桌面提供统一的、面向目标（target-aware）的 Computer Use 服务。各 Provider 继续保持平台专用，而 `ctx.computer` 会把显式目标路由到兼容 Provider，并在动作之后返回新的观察结果。Provider 偏好只用于同一目标类型内的歧义决胜，不会因此隐藏其他目标类型。

| 包 | 职责 | ctx key |
|---|---|---|
| [`computer/`](computer/README.zh.md) | 定义目标类型、观察/动作词汇、稳定错误、Provider 注册与面向目标的路由 | `ctx.computer` |
| [`computer-browser-cdp/`](computer-browser-cdp/README.zh.md) | 通过 CDP 观察和操作显式 Chromium 页面目标 | 注册到 `ctx.computer` |
| [`computer-macos/`](computer-macos/README.zh.md) | 通过辅助功能与受限原生输入观察和操作 macOS 应用/桌面目标 | 注册到 `ctx.computer` |
| [`tool-computer/`](tool-computer/README.zh.md) | 向模型暴露唯一的 `computer` 工具、观察作用域 element id、新鲜 post-action state 与语义 diff | 注册到 `ctx.tools` |

Computer Use 是基于状态的能力，而不是宏系统：优先使用语义化辅助功能状态，只在必要时退回视觉/坐标交互；element id 只属于产生它的那次观察；下一步动作必须由当前的 post-action evidence 决定。内置 `computer-use` Skill 负责这些模型侧操作规则，delivery-quality policy 负责结果层的完成证据。

[Desktop Computer Use 决策](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.zh.md)记录了浏览器 DevTools 与 macOS 辅助功能为何作为不同 Provider 置于同一服务之后。[子系统参考](../../docs/subsystems/computer.zh.md)拥有共同词汇。
