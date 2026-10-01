# Agent Note: OBIS Launch Shared Renderer Overlay

Status: implemented

English | [中文](2026-09-29-obis-launch-shared-renderer.zh.md)

## Problem

The Harness launch overlay drew Kernel page layout as nested label/value boxes. Form, DataTable, Chart, Detail, Timeline, ApprovalQueue, MetricCard, TaskList, FileViewer, KnowledgeSearch, ActionButton, WorkflowStatus, NotificationPanel, and AIAssistant looked the same, so a human who opened a published Module from Workspace could not see the shared UI Runtime component registry. Next Workspace already renders that registry through `@obis/ui-runtime`. The Harness workspace cannot depend on that package.

## Decision

`@deepseek-ai/dsh-obis-launch` renders preview and published page layout with a DOM implementation of the shared UI Runtime component ids, tagged `data-renderer-contract="obis-ui-runtime@0.1"`. Unknown components, unsupported design systems, unknown patterns, unknown tokens, and invalid registered props block the overlay. `obis-enterprise@1.0.0` is the supported design system; an omitted action list grants no action bindings. Query rows are always empty; Search, Filter, and Form controls do not execute Query, Action, Approval, or AI. ActionButton and Form submit bindings that are absent from `page.actions` fail closed; overlay ActionButtons stay disabled. ApprovalQueue does not stamp `data-page-inbox`. FileViewer and KnowledgeSearch do not stamp `data-page-files` or `data-page-knowledge`. Empty-state copy matches Next `renderer-react`.

## Alternatives considered

**Depend on `@obis/ui-runtime` from the Harness workspace.** Rejected because that package lives in the OBIS repository and ships a React renderer. The launch overlay is a vanilla DOM client plugin.

**Keep the label/value placeholder renderer.** Rejected because entitled pages are composed of Form, DataTable, Chart, Detail, Timeline, ApprovalQueue, MetricCard, TaskList, FileViewer, KnowledgeSearch, ActionButton, WorkflowStatus, NotificationPanel, and AIAssistant; placeholders hide that registry.

**Execute Kernel Query from the overlay so tables fill.** Rejected because production Query, Action, Approval, and AI stay on OBIS Workspace. The overlay presents page layout for the launch-bound page.

## Consequences

Desktop production business navigation uses [Desktop Next Business Host](../architecture/2026-10-01-desktop-next-business-host.md); this note’s DOM registry and component rules remain applicable to native previews and launch overlays.

A new component id in OBIS `25-ui-runtime` needs a matching branch in `packages/obis/launch/src/client/renderer.ts` and in Desktop `DESKTOP_APPLICATION_COMPONENTS` plus `apps/desktop/src/desktop-application-ui.ts`. The overlay still does not run production Query. Pages that use an unregistered component fail closed instead of showing a box labeled with the component name. Catalog and `module-page` scope remain [OBIS Launch Published Module Catalog](2026-09-29-obis-launch-published-catalog.md). Desktop production Query and Action stay on the Desktop host; see [Desktop Shared UI Runtime Registry](2026-09-30-desktop-shared-ui-runtime-registry.md).

## Testing

`packages/obis/launch/tests/renderer.client.spec.ts` covers the registered component set, empty-state copy, unknown-component/pattern/token/prop failures, Tabs/Drawer/Modal toggles, undeclared ActionButton/Form fail-closed, ApprovalQueue without `data-page-inbox`, and FileViewer/KnowledgeSearch without host catalog mounts. `client.spec.ts` covers overlay mounting for preview and published pages.
