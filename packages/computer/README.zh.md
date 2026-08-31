# computer/：受控本机 Computer Use

[English](README.md) | 中文

本家族为本机浏览器或桌面应用提供与 Provider 无关的检查，以及小粒度、经授权调停的输入操作。

| 包 | 职责 | ctx key |
|---|---|---|
| [`computer/`](computer/README.zh.md) | 定义 Provider 注册、选择和电脑控制词汇 | `ctx.computer` |
| [`computer-browser-cdp/`](computer-browser-cdp/README.zh.md) | 检查和操作暴露本机 Chromium DevTools 的页面 | 注册到 `ctx.computer` |
| [`computer-macos/`](computer-macos/README.zh.md) | 检查和操作 macOS 辅助功能应用 | 注册到 `ctx.computer` |
| [`tool-computer/`](tool-computer/README.zh.md) | 向模型提供经过批准的检查和输入操作 | 注册到 `ctx.tools` |

[Desktop Computer Use 决策](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.zh.md)记录了浏览器 DevTools 与 macOS 辅助功能为何作为不同 Provider 置于同一服务之后。[子系统参考](../../docs/subsystems/computer.zh.md)拥有共同词汇。
