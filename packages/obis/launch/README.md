# @deepseek-ai/dsh-obis-launch

English | [中文](README.zh.md)

Secure OBIS Workspace → Harness handoff. The browser fragment carries only a one-time `obis-launch` ticket. The Host exchanges it at `POST /v1/workspace-launches/exchange`, writes the delegated token into `ctx.credentials` under `OBIS_DELEGATED_ACCESS_TOKEN` by default, and never returns that token to the browser.

## Host RPC `/obis-launch`

| Endpoint | Payload | Result |
|---|---|---|
| `exchange` | `{ ticket, harnessOrigin }` | Non-secret launch metadata. The delegated token is stored in credentials. |
| `preview-page` | empty | Kernel preview page for the launch-bound preview ids. Refused unless the launch is `read-only` preview. |
| `catalog` | empty | Kernel `GET /v1/workspace/navigation` for the launch-bound `projectId` and `environmentId`, using the delegated token. Each call re-reads Kernel; entitled canary and published modules remain, deprecated and rolled-back modules disappear, and two employees can receive different Module sets. Refused for preview launches and when `projectId` is missing. |
| `module-page` | `{ moduleId, pageId }` only | Kernel page GET after the pair is present in that entitled catalog. Caller-selected project, environment, or extra fields are rejected. |

`baseUrl` is Host config. HTTP is allowed only for loopback. Preview launches overlay the immutable preview page. Ordinary launches overlay the entitled published catalog; opening a row loads that page as a read-only overlay and does not execute Query, Action, Approval, or AI. Page layout uses the shared UI Runtime component registry (`data-renderer-contract="obis-ui-runtime@0.1"`) with empty query rows. ActionButton and Form submit bindings that are absent from `page.actions` fail closed; overlay ActionButtons stay disabled. ApprovalQueue does not stamp an inbox mount. FileViewer and KnowledgeSearch do not stamp file or knowledge mounts. A successful `module-page` pins that module id on the Host only (not in RPC results) so later AgentRun creation can stamp the launch-bound published module.

## Model Experience

None, as this package is a Workspace handoff and browser overlay; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Catalog overlay does not execute production Query, Action, Approval, or AI** — those remain on OBIS Workspace and Desktop. Entitled Workspace Queries enter Kernel `POST /v1/queries/{query}/execute` after visibility and page/backend declaration checks. Entitled Workspace Actions enter Kernel `POST /v1/actions/execute` after entitlement and page/backend declaration checks. This package renders entitled page layout through the shared UI Runtime component registry with empty query rows; unknown components, unsupported design systems, and undeclared actions block the affected rendering. The supported design system is `obis-enterprise@1.0.0`; an omitted page action list grants no action bindings.
