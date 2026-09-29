# Agent Note: OBIS Launch Published Module Catalog

Status: implemented

[English](2026-09-29-obis-launch-published-catalog.md) | 中文

## Problem

Workspace 可以签发一次性 Harness launch ticket，且当 ticket 带有 preview 元数据时，Harness web client 已经会叠加不可变 application preview。普通 launch 只派发 `obis:launch-ready`。有权的已发布导航留在 Desktop（`GET /v1/workspace/navigation`）和 Next Workspace，因此从 Workspace 打开 Harness 的人无法在同一次交接里浏览已发布 Module 页面。Kernel page GET 需要 `projectId` 与 `environmentId`，而 launch ticket 此前只保存 environment。

## Decision

Kernel launch ticket 持久化 `projectId`（HTTP `POST /v1/workspace-launches` 要求该字段；preview launch 在省略顶层字段时复制 `preview.projectId`，不一致则拒绝）。`@deepseek-ai/dsh-obis-launch` 的 Host RPC `catalog` 只按已兑换 launch 的 `projectId` 与 `environmentId` 加载 Kernel navigation。`module-page` 接受 `{ moduleId, pageId }`，并且仅在该 pair 出现在该 catalog 之后才获取 Kernel page。preview launch 继续使用现有 `preview-page` overlay，不能调用 `catalog`。浏览器 overlay 是只读的有权 catalog 与页面视图；Query、Action、Approval 和 AI 留在 OBIS Workspace。委托令牌仍留在 Host credentials，从不返回浏览器。

## Alternatives considered

**让 web client 在 RPC 上自选 `projectId` / `environmentId` / `moduleId`。** 拒绝，因为 launch ticket 才是权限绑定。调用方自选 scope 会让浏览器向 Kernel 索取 Workspace 交接之外的页面。

**把 Desktop IPC 复用到 web Harness client。** 拒绝，因为 web client 没有 Electron application 主进程；Host RPC 已是现有 launch 凭据边界。

**ticket 不带 `projectId`，只按 `environmentId` 列出 navigation。** 拒绝，因为 Kernel `GET /v1/workspace/modules/:moduleId/pages/:pageId` 需要两个 id，不能加载页面的 catalog 不是已发布 Module catalog。

## Consequences

带 `projectId` 的 Workspace 或 Enterprise Harness launch 在兑换后可以叠加有权的已发布应用。preview ticket 仍只走 preview。Host 测试钉住 catalog/module-page 的 launch 绑定 scope，Kernel 测试钉住 ticket `projectId` 持久化。生产 Query/Action/AI 的 overlay 执行仍不在此包内；页面 layout 使用 [OBIS Launch Shared Renderer Overlay](2026-09-29-obis-launch-shared-renderer.zh.md) 中的共享渲染器。

## Testing

`packages/obis/launch/tests/host.spec.ts` 与 `client.spec.ts` 覆盖 Host RPC 和浏览器 overlay。`packages/obis/launch/tests/renderer.spec.ts` 覆盖共享渲染器的空数据状态与未知组件阻断。`10-kernel/test/platform-workspace-launch.test.ts` 与 `platform-workspace-http.test.ts` 覆盖 ticket `projectId` 与 HTTP 校验。
