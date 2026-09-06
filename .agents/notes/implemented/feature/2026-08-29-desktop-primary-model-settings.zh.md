# Agent Note: 桌面端主模型设置

Status: implemented

[English](2026-08-29-desktop-primary-model-settings.md) | 中文

## 问题

Desktop 产品需要一份控制对话所用 ACP 运行时的 OpenAI 兼容模型配置。让 Renderer 持有明文凭据，或在 UI 中维护第二套模型客户端，都会暴露密钥，并绕过运行时负责的会话、工具、审批和持久化行为。

## 决策

设置对话框提供仅限 Desktop 的“模型 API”区域，用于配置协议、Base URL、模型 ID 和 API Key。Electron 主进程校验非敏感字段，使用 `safeStorage` 加密密钥，并以仅所有者可读写的权限把加密凭据写入用户数据目录。preload API 只返回脱敏状态，绝不向 Renderer 暴露已保存的密钥。

保存时会先通过选定的 OpenAI Chat Completions 或 Responses 协议发送一次有上限、带函数工具声明的文字请求。协议、凭据、模型 ID 或工具请求不兼容时，会在修改现有设置与运行时之前失败。第二次有上限的请求检测可选图片输入；失败时记录为仅文字模型，不拒绝仍可使用的端点。若网关通过常见扩展公布上下文与输出容量，可选的 `GET /models` 元数据会提供这些数值。

只有验收成功后，托管的 ACP 运行时才会重启。`examples/acp-agent/cordis.yml` 仅在存在 Desktop 模型环境时选择 `llm-pi-ai` provider；它通过 `baseURLEnv` 引用从不可变启动环境快照解析端点，不在配置中直接求值 `process.env`。该路由使用内置 OpenAI catalog，因此已知模型 ID 会继承准确的 token、模态和 effort 事实，而用户选择的协议与已验证端点值优先。未知模型默认仅文字、32K 上下文、8K 输出能力且不发送推理强度。保守兼容开关会省略通用网关经常拒绝的 developer role、严格工具声明、store 和流式 usage 扩展。CLI、快照和其他 ACP 启动方式继续默认使用普通 DeepSeek provider。

## 考虑过的替代方案

**从 Renderer 直接调用模型。** 这会简化表单提交，但会把凭据交给浏览器代码，并产生一套不包含运行时审批、工具和持久会话的并行对话实现。

**把 API Key 保存到 JSON 设置文件。** 这种方式更便于迁移，但会留下可复用的明文凭据。Electron `safeStorage` 使用操作系统保护存储，使配置文件不包含敏感明文。

**无条件替换共享 ACP 配置。** 这会改变 CLI、回放和快照行为。Desktop 专用环境开关把 provider 选择限制在打包应用托管的运行时内。

**探测每一种推理强度和上下文大小。** 重复付费请求仍无法可靠证明上下文上限，还可能在保存时触发限流。内置 catalog 为已知模型提供准确的 effort 数据；未知模型省略 effort 参数，端点元数据只有明确公布时才采用。

## 后果

- 保存后的 provider 会在运行时重连后用于新提示和恢复的 ACP 会话。
- 基线验收失败时，原有加密设置与正在运行的 Runtime 保持不变。
- 只有真实请求成功后才启用可选图片输入；仅文字模型仍可开启 Computer Use，但不能检查截图。
- 现有版本 1 和版本 2 设置会迁移为未验证的仅文字记录，并在下次保存时完成验收。
- Renderer 可以判断密钥是否存在，但不能读取密钥。
- 修改模型设置会短暂重启本地运行时，随后 supervisor 会重新连接产品客户端。
- 容量发现仍是提示性信息，因为标准 OpenAI 模型列表响应没有定义模态、effort 或上下文字段。
