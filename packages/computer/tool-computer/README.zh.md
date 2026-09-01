# `@deepseek-ai/dsh-tool-computer`

[English](README.md) | 中文

提供单一模型侧 `computer` 工具，包含受限动作 `list`、`observe`、`click`、`drag`、`set_value`、`type_text`、`paste`、`key`、`scroll`、`secondary_action`。`list` 与仅辅助功能的 `observe` 为只读操作。视觉观察和所有变更状态的操作复用现有一次性授权服务；模型调用不会获得持久应用授权。

工具优先使用语义化、仅属于当前 observation 的元素 id。每次变更操作都会返回新的 observation，并使上一轮 observation 的元素 id 失效。若前后都存在语义状态，工具会基于同一 Agent + target 的上一轮观察输出受限 diff；显式 `observe` 返回完整当前状态，也是遇到 stale/ambiguous 状态后的恢复路径。最近观察只保留一个短 TTL，不会成为持久控制状态。

视觉观察通过 `ctx.attachments` 保存，使图像作为持久、模型可见的工具内容存在，同时控制缓存本身保持短生命周期。

## Model Experience

### Request context and condition

#### What the model sees

一个 `computer` schema 与每次返回的目标 observation。默认返回辅助功能状态；显式请求视觉观察时返回图像工具结果块。变更操作结果包含新的当前状态；若前后语义状态都存在，还会包含精简 change diff。

#### Token effect

显式观察时完整语义状态进入上下文。操作后的语义结果优先呈现受限 diff，减少重复状态 token；显式请求的截图仍进入工具结果消息。

#### KV Cache effect

每次操作追加工具结果，并使后续请求后缀的缓存复用失效。

## Known Limitations and Deferred Work

- **No persistent app grant** — 每次视觉观察或状态变更操作都接收明确的一次性授权决定。
- **No persistent macro state** — 短生命周期 observation cache 只用于保证新鲜度和渲染 diff，不负责调度或重放手势。
