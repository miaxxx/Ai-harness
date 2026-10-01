# Agent Note: Desktop Shared UI Runtime Registry

Status: implemented

[English](2026-09-30-desktop-shared-ui-runtime-registry.md) | 中文

## Problem

Next Workspace 与 Preview 通过 `@obis/ui-runtime` 渲染有权页面 layout（`data-renderer-contract="obis-ui-runtime@0.1"`）。Harness launch overlay 用 DOM 实现同一套组件 id。Desktop 校验的是更小的 `DESKTOP_APPLICATION_COMPONENTS` 允许列表，因此 MetricCard、TaskList、FileViewer、KnowledgeSearch、ActionButton、WorkflowStatus、NotificationPanel、AIAssistant 页面会在 Desktop 上 fail closed，而其他 host 可以渲染它们。

## Decision

Desktop 的 `DESKTOP_APPLICATION_COMPONENTS` 与 OBIS `25-ui-runtime` 的 `compatibility.json` 一致。生产与 preview canvas 标记 `data-renderer-contract="obis-ui-runtime@0.1"`。未知组件、token、pattern 以及不受支持的 design system 仍 fail closed。layout 上的 ActionButton 在 `props.action` 不在 `page.actions` 时 fail closed。当该 action 已声明、有权且有 IR binding 时，按钮打开对应的页面 action form。按钮从不单独用 layout props 调用 `bridge.action`。layout Form 在已声明 `props.action` 时走同一套 IR action form；未声明的 submit binding fail closed。Preview Form 保留 layout 字段和 host-adapter 提示，不盖 `data-page-action`。layout 上的 TaskList 与 ApprovalQueue 在生产页面上 hydrate 有权的 Kernel 任务与审批 inbox，而不会把受治理 query 行投影成这些 inbox。Preview 不 hydrate 这些挂载点。layout FileViewer 在 `data-page-files` 上 hydrate 有权的 query 对象元数据；KnowledgeSearch 在 `data-page-knowledge` 上 hydrate Kernel `POST /v1/harness/knowledge/search` 命中。Preview 不盖这些挂载点。AIAssistant 使用与 AIComposer 相同的 compose 适配器做 hydrate。依赖 Query 的组件先等待受治理的 page query，再在本地投影可见行。

## Alternatives considered

**把 `@obis/ui-runtime` 引进 Electron。** 拒绝，因为该包在 OBIS 仓库里，并且带的是 React 渲染器。Desktop 页面渲染已是会执行受治理 Query 与 Action 的 vanilla DOM host。

**维持子集允许列表并文档化缺口。** 拒绝，因为有权的 Builder 页面已经会组合这些缺失 id；拒绝它们的 host 不是共享 UI Runtime。

**让 layout ActionButton 从 `props.action` 调用 `bridge.action`。** 拒绝，因为 page schema 不能发明执行权限。Desktop 通过 IR 支持的 action bar 执行已声明的 page action；layout ActionButton 只打开该 form。

## Consequences

Desktop 生产业务导航使用 [Desktop Next 业务宿主](../architecture/2026-10-01-desktop-next-business-host.zh.md)；本文的 DOM 清单和组件规则继续适用于原生预览与启动浮层。

`25-ui-runtime` 新增组件 id 时，Desktop 注册表与渲染分支以及 [OBIS Launch Shared Renderer Overlay](2026-09-29-obis-launch-shared-renderer.zh.md) 中的 launch overlay 都要跟上。Desktop fixture `apps/desktop/tests/fixtures/obis-ui-runtime-contract.json` 是该注册表在本仓库内的钉。Preview evaluation 仍只读；生产 Query 与 Action 留在 Desktop bridge。

## Testing

`apps/desktop/tests/application-runtime.spec.ts` 要求 Desktop 注册表与 fixture 完全一致。`apps/desktop/tests/application-golden-contract.spec.ts` 渲染新增组件、盖上 contract 属性，证明未声明的 layout ActionButton 与 Form 会 fail closed，证明已声明的 ActionButton 或 Form 会打开 IR form 而不从 layout props 调用 `bridge.action`，证明 TaskList 与 ApprovalQueue 会 hydrate 有权 inbox 而不是 query 行，证明 FileViewer 与 KnowledgeSearch 在生产上 hydrate 有权 catalog 挂载点、在 preview 上只保留 hint，并证明 Execute → 刷新审批 → 重放走 IR action bar。

页面缺少 Action 清单时，布局中的 Form 和 ActionButton 不取得执行权限。
