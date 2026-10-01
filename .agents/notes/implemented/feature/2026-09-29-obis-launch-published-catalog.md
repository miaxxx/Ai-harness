# Agent Note: OBIS Launch Published Module Catalog

Status: implemented

English | [中文](2026-09-29-obis-launch-published-catalog.zh.md)

## Problem

Workspace can mint a one-time Harness launch ticket, and the Harness web client already overlays an immutable application preview when the ticket carries preview metadata. Ordinary launches only dispatched `obis:launch-ready`. Entitled published navigation lived on Desktop (`GET /v1/workspace/navigation`) and Next Workspace, so a human who opened Harness from Workspace could not browse published Module pages in the same handoff. Kernel page GET requires `projectId` and `environmentId`, while launch tickets previously stored environment only.

## Decision

Kernel launch tickets persist `projectId` (HTTP `POST /v1/workspace-launches` requires it; preview launches copy `preview.projectId` when the top-level field is omitted and reject a mismatch). `@deepseek-ai/dsh-obis-launch` Host RPC `catalog` loads Kernel navigation for the exchanged launch's `projectId` and `environmentId` only. `module-page` accepts `{ moduleId, pageId }` and fetches the Kernel page only after that pair appears in that catalog. Preview launches keep the existing `preview-page` overlay and cannot call `catalog`. The browser overlay is a read-only entitled catalog and page view; Query, Action, Approval, and AI stay on OBIS Workspace. The delegated token remains in Host credentials and is never returned to the browser.

## Alternatives considered

**Let the web client pick `projectId` / `environmentId` / `moduleId` on RPC.** Rejected because the launch ticket is the authority binding. A caller-selected scope would let the browser ask Kernel for pages outside the Workspace handoff.

**Reuse Desktop IPC for the web Harness client.** Rejected because the web client has no Electron application main process; Host RPC is the existing launch credential boundary.

**Skip `projectId` on tickets and list navigation by `environmentId` only.** Rejected because Kernel `GET /v1/workspace/modules/:moduleId/pages/:pageId` requires both ids, so a catalog that cannot load pages is not a published Module catalog.

## Consequences

A Workspace or Enterprise Harness launch that includes `projectId` can overlay entitled published applications after exchange. Preview tickets remain preview-only. Host tests pin catalog/module-page launch-bound scope, and Kernel tests pin ticket `projectId` persistence. Each `catalog` RPC re-reads Kernel navigation with the delegated token, so entitled canary modules remain, deprecated and rolled-back modules leave the overlay on the next call, and two employees can receive different Module sets. Overlay execution of production Query/Action/AI remains out of this package; entitled Workspace Queries still enter Kernel `POST /v1/queries/{query}/execute` after visibility and declaration checks, and entitled Workspace Actions still enter Kernel `POST /v1/actions/execute` after entitlement and declaration checks. Page layout uses the shared renderer in [OBIS Launch Shared Renderer Overlay](2026-09-29-obis-launch-shared-renderer.md).

## Testing

`packages/obis/launch/tests/host.spec.ts` and `client.spec.ts` cover Host RPC and the browser overlay, including a catalog re-read that drops a module after Kernel navigation becomes empty, and two Hosts whose delegated tokens receive different Kernel catalogs. `packages/obis/launch/tests/renderer.client.spec.ts` covers shared renderer empty states and blocked unknown components. `10-kernel/test/platform-workspace-launch.test.ts` and `platform-workspace-http.test.ts` cover ticket `projectId` and HTTP validation. Kernel `platform-application-employee-navigation.test.ts` and `platform-workspace-navigation-http.test.ts` pin two employees in the same project receiving different Module sets. Kernel `platform-application-canary-navigation.test.ts` and `platform-workspace-canary-navigation-http.test.ts` pin entitled canary modules remaining in navigation and Runtime MCP catalogs. Kernel `platform-workspace-action-http.test.ts` pins Workspace page Actions reaching Kernel execute only after entitlement and declaration checks. Kernel `platform-workspace-query-http.test.ts` pins Workspace page Queries reaching Kernel execute only after visibility and declaration checks.
