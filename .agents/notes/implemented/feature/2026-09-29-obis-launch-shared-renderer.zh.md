# Agent Note: OBIS Launch Shared Renderer Overlay

Status: implemented

[English](2026-09-29-obis-launch-shared-renderer.md) | 中文

## Problem

Harness launch overlay 把 Kernel 页面 layout 画成嵌套的 label/value 盒子。Form、DataTable、Chart、Detail、Timeline、ApprovalQueue、MetricCard、TaskList、FileViewer、KnowledgeSearch、ActionButton、WorkflowStatus、NotificationPanel、AIAssistant 看起来一样，因此从 Workspace 打开已发布 Module 的人看不到共享 UI Runtime 组件注册表。Next Workspace 已经通过 `@obis/ui-runtime` 渲染该注册表。Harness workspace 不能依赖那个包。

## Decision

`@deepseek-ai/dsh-obis-launch` 用 DOM 实现共享 UI Runtime 的组件 id 来渲染 preview 与已发布页面 layout，并标记 `data-renderer-contract="obis-ui-runtime@0.1"`。未知组件、不支持的设计系统、未知 pattern、未知 token，以及已注册 prop 的非法值会阻断 overlay。支持的设计系统为 `obis-enterprise@1.0.0`；省略动作列表时不授予任何动作绑定。Query 行始终为空；Search、Filter、Form 控件不执行 Query、Action、Approval 或 AI。`page.actions` 中不存在的 ActionButton 与 Form submit binding 会 fail closed；overlay 上的 ActionButton 保持 disabled。ApprovalQueue 不盖 `data-page-inbox`。FileViewer 与 KnowledgeSearch 不盖 `data-page-files` 或 `data-page-knowledge`。空数据文案与 Next `renderer-react` 一致。

## Alternatives considered

**让 Harness workspace 依赖 `@obis/ui-runtime`。** 拒绝，因为该包在 OBIS 仓库里，并且带的是 React 渲染器。launch overlay 是 vanilla DOM 的 client 插件。

**继续用 label/value 占位渲染。** 拒绝，因为有权页面由 Form、DataTable、Chart、Detail、Timeline、ApprovalQueue、MetricCard、TaskList、FileViewer、KnowledgeSearch、ActionButton、WorkflowStatus、NotificationPanel、AIAssistant 组成；占位会把注册表藏起来。

**在 overlay 里执行 Kernel Query 以填表。** 拒绝，因为生产 Query、Action、Approval、AI 留在 OBIS Workspace。overlay 只展示 launch 绑定页面的 layout。

## Consequences

Desktop 生产业务导航使用 [Desktop Next 业务宿主](../architecture/2026-10-01-desktop-next-business-host.zh.md)；本文的 DOM 清单和组件规则继续适用于原生预览与启动浮层。

OBIS `25-ui-runtime` 新增组件 id 时，需要在 `packages/obis/launch/src/client/renderer.ts` 以及 Desktop 的 `DESKTOP_APPLICATION_COMPONENTS` 与 `apps/desktop/src/desktop-application-ui.ts` 增加对应分支。overlay 仍不跑生产 Query。使用未注册组件的页面会阻断 overlay，而不是显示以组件名为标签的盒子。catalog 与 `module-page` 的 scope 仍由 [OBIS Launch Published Module Catalog](2026-09-29-obis-launch-published-catalog.zh.md) 决定。Desktop 生产 Query 与 Action 留在 Desktop host；见 [Desktop Shared UI Runtime Registry](2026-09-30-desktop-shared-ui-runtime-registry.zh.md)。

## Testing

`packages/obis/launch/tests/renderer.client.spec.ts` 覆盖已注册组件集合、空数据文案、未知组件/pattern/token/prop 失败、Tabs/Drawer/Modal 开关、未声明 ActionButton/Form 的 fail-closed，ApprovalQueue 不盖 `data-page-inbox`，以及 FileViewer/KnowledgeSearch 不盖 host catalog 挂载点。`client.spec.ts` 覆盖 preview 与已发布页面的 overlay 挂载。
