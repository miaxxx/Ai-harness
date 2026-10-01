# @deepseek-ai/dsh-obis-launch

[English](README.md) | 中文

安全的 OBIS Workspace → Harness 交接。浏览器 fragment 只携带一次性 `obis-launch` ticket。Host 在 `POST /v1/workspace-launches/exchange` 兑换它，把委托令牌写入 `ctx.credentials`（默认引用 `OBIS_DELEGATED_ACCESS_TOKEN`），并且从不把该令牌返回给浏览器。

## Host RPC `/obis-launch`

| Endpoint | Payload | Result |
|---|---|---|
| `exchange` | `{ ticket, harnessOrigin }` | 不含密钥的 launch 元数据。委托令牌存入 credentials。 |
| `preview-page` | empty | 仅使用 launch 绑定 preview id 的 Kernel preview 页面。除非 launch 是 `read-only` preview，否则拒绝。 |
| `catalog` | empty | 针对 launch 绑定的 `projectId` 与 `environmentId`，用委托令牌调用 Kernel `GET /v1/workspace/navigation`。每次调用都重新读取 Kernel；有权的 canary 与 published 模块会保留，deprecated 与 rolled-back 模块会消失，且两名员工可以收到不同的 Module 集合。preview launch 或缺 `projectId` 时拒绝。 |
| `module-page` | 仅 `{ moduleId, pageId }` | 在该 entitlement catalog 含有该 pair 之后调用 Kernel page GET。调用方自选的 project、environment 或额外字段一律拒绝。 |

`baseUrl` 是 Host 配置。HTTP 仅允许 loopback。preview launch 叠加不可变 preview 页面。普通 launch 叠加已发布且有权的 catalog；打开一行会以只读 overlay 加载该页面，并不执行 Query、Action、Approval 或 AI。页面 layout 使用共享 UI Runtime 组件注册表（`data-renderer-contract="obis-ui-runtime@0.1"`），Query 行始终为空。`page.actions` 中不存在的 ActionButton 与 Form submit binding 会 fail closed；overlay 上的 ActionButton 保持 disabled。ApprovalQueue 不盖 inbox 挂载点。FileViewer 与 KnowledgeSearch 不盖 file 或 knowledge 挂载点。一次成功的 `module-page` 只在 Host 上钉住该 module id（不出现在 RPC 结果里），供之后创建 AgentRun 时盖上 launch 绑定的已发布 Module。

## 模型体验

无。该包是 Workspace 交接与浏览器 overlay；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **Catalog overlay 不执行生产 Query、Action、Approval 或 AI** — 这些留在 OBIS Workspace 与 Desktop。有权的 Workspace Query 在通过可见性与 page/backend 声明检查后进入 Kernel `POST /v1/queries/{query}/execute`。有权的 Workspace Action 在通过 entitlement 与 page/backend 声明检查后进入 Kernel `POST /v1/actions/execute`。本包通过共享 UI Runtime 组件注册表渲染有权的页面 layout，Query 行始终为空；未知组件、不支持的设计系统及未声明动作会阻断对应渲染。支持的设计系统为 `obis-enterprise@1.0.0`；页面未提供动作列表时不授予任何动作绑定。
