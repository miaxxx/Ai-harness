# Agent Note: Desktop Orbis 产品身份

Status: implemented

[English](2026-08-31-desktop-orbis-product-identity.md) | 中文

## Problem

Desktop 应用复用了仓库的官方 DeepSeek Harness 品牌 occupant、通用空白 Session 文案和固定 Harness 系统提示词身份。这种展示将独立 Desktop 产品与底层 agent harness（智能体框架）以及 DeepSeek 模型和搜索提供方混为一体。

## Decision

Desktop 拥有 Orbis 专属客户端插件，用于填充共享侧边栏和主视觉品牌 slot。展开侧边栏渲染 `Orbis`，紧凑栏渲染 `O` 字母标记，空白 Session 主视觉使用构建时 `Orbis AI` 标题，不显示通用鲸鱼标记或预览徽标。Electron 窗口界面、权限文案、失败文案、应用包身份和打包应用名称均使用 Orbis AI。

Desktop ACP 组合禁用固定 Harness 身份，并提供以 `You are Orbis AI` 开头的 Desktop 专属 persona。其他 ACP 组合默认保留固定 Harness 身份。DeepSeek 提供方名称、模型 id、API 环境变量、包作用域和仓库路径仍是技术标识，因为修改它们会错误描述已配置的提供方或破坏解析，而不是改变产品展示。

## Alternatives considered

**重命名仓库中的每个 DeepSeek 标识。** 不采用，因为提供方路由、环境变量、包作用域和模型 id 描述真实的集成与兼容点，而不是 Desktop 品牌。

**用 CSS 覆盖可见文本。** 不采用，因为无障碍文本、窗口元数据、权限对话框、打包文件名和模型可见身份仍会保留冲突品牌。

## Consequences

Desktop 在可见 UI、打包产物和模型行为中拥有统一产品身份，共享 harness 与提供方集成则保持准确。ACP 应用暴露现有身份退出选项，使产品专属 persona 可以显式替换默认身份。品牌验证覆盖展开、紧凑和主视觉 occupant；打包冒烟测试会解析 Orbis AI 应用与可执行文件名称。
