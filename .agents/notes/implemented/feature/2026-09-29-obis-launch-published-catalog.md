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

A Workspace or Enterprise Harness launch that includes `projectId` can overlay entitled published applications after exchange. Preview tickets remain preview-only. Host tests pin catalog/module-page launch-bound scope, and Kernel tests pin ticket `projectId` persistence. Overlay execution of production Query/Action/AI remains out of this package; page layout uses the shared renderer in [OBIS Launch Shared Renderer Overlay](2026-09-29-obis-launch-shared-renderer.md).

## Testing

`packages/obis/launch/tests/host.spec.ts` and `client.spec.ts` cover Host RPC and the browser overlay. `packages/obis/launch/tests/renderer.spec.ts` covers shared renderer empty states and blocked unknown components. `10-kernel/test/platform-workspace-launch.test.ts` and `platform-workspace-http.test.ts` cover ticket `projectId` and HTTP validation.
