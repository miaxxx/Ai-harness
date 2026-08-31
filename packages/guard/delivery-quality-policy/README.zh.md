# @deepseek-ai/dsh-delivery-quality-policy

[English](README.md) | 中文

这是一个零配置提示词策略，把最终状态验收纳入每个已组装 agent 的轮次。它不修改 agent loop，不自行读取文件，也不自行裁决产物。策略要求模型从请求中提取可观察检查项，在最后一次有意义修改后验证，检查实际渲染的视觉输出，修复失败并重新执行受影响检查，然后才能宣告完成。

该插件依赖 `ctx.systemPrompt`，并以顺序 `120` 注册 `policy:delivery-quality` 段落。

```yaml
- id: delivery-quality-policy
  name: '@deepseek-ai/dsh-delivery-quality-policy'
```

base bundle 在全局挂载该策略。产品 preset 同时暴露内置 `delivery-verification` Skill。会话目录中存在该 Skill 时，策略要求加载它；该 Skill 按代码、浏览器 UI、文档、PDF、演示文稿、表格、图片与有来源研究分流到类型化验收。现有 Skill 目录规则提供确定的选择语义：任务明确匹配 Skill 描述时，必须在执行任务操作之前加载它。

该策略不新增 Session 事件、工具 schema、服务、可变状态或产物分类器。模型可见提示词重建仍由 `dsh-system-prompt` 与请求 header 负责。最终回复必须列出产物和实际执行的检查；无法使用的验证器必须作为明确限制报告，不能暗示已经通过。

## 模型体验

### 最终状态验收段落

#### What the model sees

静态 `policy:delivery-quality` 段落要求执行可观察的最终状态验收、在可用时加载内置验证 Skill、对视觉产物执行渲染后检查，并对失败检查进入修复和重新检查循环。它还要求最终回复只列出实际执行的验证。

#### Token effect

除非有效提示词被 complete 段落替换，否则每次请求都会携带固定策略文本。类型化流程在加载 `delivery-verification` 前不会进入提示词，因此无关参考内容不消耗 token。

#### KV Cache effect

在进程生命周期内保持前缀稳定。全局段落在 agent 创建前挂载且不再变化，因此后续轮次可以复用同一提示词前缀。

## 已知限制与暂缓事项

- 该策略约束模型流程，单项检查的权威仍是确定性工具。通用宿主侧通过／失败分类器需要当前 harness 并不拥有的产物所有权与格式化提供方。
- complete persona 会按设计抑制其他全部提示词段落，其中包括本策略；这类 preset 自行拥有完整的完成策略。
- 未交付内置 Skill 的部署仍会获得全局验收循环，并直接使用可用工具。

设计详见[全局最终状态产物验收](../../../.agents/notes/implemented/feature/2026-08-31-global-delivery-acceptance.zh.md)。
