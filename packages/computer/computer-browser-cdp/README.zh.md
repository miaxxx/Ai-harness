# `@deepseek-ai/dsh-computer-browser-cdp`

[English](README.md) | 中文

为 [`dsh-computer`](../computer/README.zh.md) 提供 Chromium DevTools Protocol 实现。将 `DSH_BROWSER_CDP_URL` 设为本机浏览器端点，例如 `http://127.0.0.1:9222`；该实现列出页面目标，并只通过结构化 DevTools 命令控制已选择的目标。取消活动轮次会关闭对应连接，并拒绝仍在等待的检查或截图命令。

## 模型体验

通过 `@deepseek-ai/dsh-tool-computer` 间接可见。

#### KV Cache 影响

Provider 自身不增加上下文；持久化结果与缓存行为由消费工具负责。

## 已知限制和延期工作

- 浏览器必须已启用本机远程调试。该实现不会启动浏览器、穿越登录提示，也不会授予文件系统、Shell 或原生应用权限。每个会修改状态的操作仍须通过 `computer` 工具的用户批准。
