# Agent Note: 桌面端主模型设置

Status: implemented

[English](2026-08-29-desktop-primary-model-settings.md) | 中文

## 问题

Desktop 产品需要一份控制对话所用 ACP 运行时的 OpenAI 兼容模型配置。让 Renderer 持有明文凭据，或在 UI 中维护第二套模型客户端，都会暴露密钥，并绕过运行时负责的会话、工具、审批和持久化行为。

## 决策

设置对话框提供仅限 Desktop 的“模型 API”区域，用于配置协议、Base URL、模型 ID 和 API Key。Electron 主进程校验非敏感字段，使用 `safeStorage` 加密密钥，并以仅所有者可读写的权限把加密凭据写入用户数据目录。preload API 只返回脱敏状态，绝不向 Renderer 暴露已保存的密钥。

保存设置后，托管的 ACP 运行时会使用选定的 OpenAI Chat Completions 或 Responses 协议重启。`examples/acp-agent/cordis.yml` 仅在存在 Desktop 模型环境时选择 `llm-pi-ai` provider；它通过 `baseURLEnv` 引用从不可变启动环境快照解析端点，不在配置中直接求值 `process.env`。CLI、快照和其他 ACP 启动方式继续默认使用普通 DeepSeek provider。因此，对话保留既有 ACP 会话与工具链路，同时把用户在 Desktop 中选择的 provider 作为主模型。

## 考虑过的替代方案

**从 Renderer 直接调用模型。** 这会简化表单提交，但会把凭据交给浏览器代码，并产生一套不包含运行时审批、工具和持久会话的并行对话实现。

**把 API Key 保存到 JSON 设置文件。** 这种方式更便于迁移，但会留下可复用的明文凭据。Electron `safeStorage` 使用操作系统保护存储，使配置文件不包含敏感明文。

**无条件替换共享 ACP 配置。** 这会改变 CLI、回放和快照行为。Desktop 专用环境开关把 provider 选择限制在打包应用托管的运行时内。

## 后果

- 保存后的 provider 会在运行时重连后用于新提示和恢复的 ACP 会话。
- Renderer 可以判断密钥是否存在，但不能读取密钥。
- 修改模型设置会短暂重启本地运行时，随后 supervisor 会重新连接产品客户端。
- 协议、Base URL、模型 ID 与 API Key 之外的 provider 专用控制项不属于本设置区域。
