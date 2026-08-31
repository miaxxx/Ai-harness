# `@deepseek-ai/dsh-tool-computer`

[English](README.md) | 中文

提供 `computer` 工具。`list` 和仅文本的 `inspect` 是只读操作。每次截图、点击、文本输入、按键和滚动都通过 `ctx.approval` 请求一次性决定；模型调用不会取得持久应用授权。截图通过 `ctx.attachments` 保存，因此作为持久化且模型可见的工具内容存在。

## Model Experience

### Request context and condition

#### What the model sees

`computer` schema 和每个返回的应用快照。请求截图时会返回图像工具结果块。

#### Token effect

快照文本和任意截图会进入工具结果消息。

#### KV Cache effect

每次操作追加工具结果，并使后续请求后缀的缓存复用失效。

## Known Limitations and Deferred Work

- **No persistent app grant** — 初始版本对每次截图或变更应用状态的操作均请求授权。
