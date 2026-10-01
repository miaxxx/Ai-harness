# Agent Note: Desktop Shared UI Runtime Registry

Status: implemented

English | [中文](2026-09-30-desktop-shared-ui-runtime-registry.zh.md)

## Problem

Next Workspace and Preview render entitled page layout through `@obis/ui-runtime` (`data-renderer-contract="obis-ui-runtime@0.1"`). The Harness launch overlay implements the same component ids in DOM. Desktop validated a smaller `DESKTOP_APPLICATION_COMPONENTS` allowlist, so MetricCard, TaskList, FileViewer, KnowledgeSearch, ActionButton, WorkflowStatus, NotificationPanel, and AIAssistant pages failed closed on Desktop while the other hosts rendered them.

## Decision

Desktop `DESKTOP_APPLICATION_COMPONENTS` matches OBIS `25-ui-runtime` `compatibility.json`. Production and preview canvases stamp `data-renderer-contract="obis-ui-runtime@0.1"`. Unknown components, tokens, patterns, and unsupported design systems still fail closed. Layout ActionButton fails closed when `props.action` is absent from `page.actions`. When the action is declared, entitled, and has an IR binding, the button opens that page action form. The button never calls `bridge.action` from layout props alone. Layout Form with a declared `props.action` uses the same IR action form; undeclared submit bindings fail closed. Preview Form keeps layout fields and a host-adapter hint and does not stamp `data-page-action`. Layout TaskList and ApprovalQueue hydrate entitled Kernel task and Approval inboxes on production pages; they do not project governed query rows as those inboxes. Preview does not hydrate those mounts. Layout FileViewer hydrates entitled query object metadata on `data-page-files`; KnowledgeSearch hydrates Kernel `POST /v1/harness/knowledge/search` hits on `data-page-knowledge`. Preview does not stamp those mounts. AIAssistant hydrates with the same compose adapter as AIComposer. Query-backed components wait for the governed page query, then project visible rows locally.

## Alternatives considered

**Import `@obis/ui-runtime` into Electron.** Rejected because that package lives in the OBIS repository and ships a React renderer. Desktop page rendering is a vanilla DOM host that already executes governed Query and Action.

**Keep the subset allowlist and document the gap.** Rejected because entitled Builder pages already compose the missing ids; a host that refuses them is not the shared UI Runtime.

**Let layout ActionButton call `bridge.action` from `props.action`.** Rejected because page schema cannot invent execution authority. Desktop executes declared page actions through the IR-backed action bar; layout ActionButton only opens that form.

## Consequences

Desktop production business navigation uses [Desktop Next Business Host](../architecture/2026-10-01-desktop-next-business-host.md); this note’s DOM registry and component rules remain applicable to native previews and launch overlays.

A new component id in `25-ui-runtime` needs matching Desktop registry and render branches as well as the launch overlay in [OBIS Launch Shared Renderer Overlay](2026-09-29-obis-launch-shared-renderer.md). The Desktop fixture `apps/desktop/tests/fixtures/obis-ui-runtime-contract.json` is the in-repo pin of that registry. Preview evaluation remains read-only; production Query and Action stay on the Desktop bridge.

## Testing

`apps/desktop/tests/application-runtime.spec.ts` requires the Desktop registry to equal the fixture. `apps/desktop/tests/application-golden-contract.spec.ts` renders the added components, stamps the contract attribute, proves undeclared layout ActionButton and Form fail closed, including pages with no action list, proves a declared ActionButton or Form opens the IR form without calling `bridge.action` from layout props, proves TaskList and ApprovalQueue hydrate entitled inboxes rather than query rows, proves FileViewer and KnowledgeSearch hydrate entitled catalog mounts on production and stay hint-only on preview, and proves Execute → approval refresh → replay uses the IR action bar.
