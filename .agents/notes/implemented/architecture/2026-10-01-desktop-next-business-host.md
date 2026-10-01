# Agent Note: Desktop Next Business Host

Status: implemented

English | [中文](2026-10-01-desktop-next-business-host.zh.md)

## Problem

Builder publishes business page schemas whose React rendering already belongs to OBIS Next Workspace. Independent Desktop production rendering duplicates form, permission and navigation behavior and prevents one business UI release from reaching both clients.

## Decision

Desktop business navigation opens the configured OBIS Next origin in a sandboxed WebContentsView inside the shared Mona/Harness conversation window. The additive sidebar.navigation slot places business entries above the original workspace and session browser; restoring chat keeps the mounted conversation. Fixed entries expose applications, shared application spaces, knowledge and Builder. The remote view has no privileged preload, denies permission requests and new windows, and rejects navigation or redirects to other origins. Native Module links require a trusted sender and validated project/environment. The Next BFF performs the Kernel page authorization when resolving the route; native navigation does not fetch the page a second time. Credentials never enter route parameters.

Desktop Main requests an opaque Web session from the authenticated human source Session and installs it as the Next HttpOnly cookie. The BFF alone exchanges that cookie for delegated API credentials. Entry changes check native credential readiness and reuse the linked cookie until expiry; logout and tenant changes clear it. A redirect to sign-in hides the business view and reports a business login prompt without reloading chat. Issuance completing after logout cannot reopen the business view. The DOM renderer remains for native previews and the Harness launch overlay, whose registry is owned by [Desktop Shared UI Runtime Registry](../feature/2026-09-30-desktop-shared-ui-runtime-registry.md).

For native AI reads, Main consumes a human-approved Workspace ticket against the same server-validated identity and scope. The ACP Host receives delegated access through its credential provider, mounts the existing OBIS tool consumer, and creates a source-bound AgentRun. Scope changes during issuance reject startup. Ordinary AI remains workspace-bound rather than implicitly selecting a Module. Bounded event reads retain the Run lease in Host headers and close SSE before returning.

Business selection reuses the composer reference codec and hover submenu. Non-secret JSON selection is logged in the human message, so the tool adapter can reconstruct it after resume without reading renderer state. Each selected Module version owns its Run cache key; attachment retains the original Harness Session identity. Kernel checks publication and entitlement before creating the bound Run. The configured reference autonomy permits human-approved proposals while ordinary conversations remain read-only. A renderer selection never grants execution authority.

## Alternatives considered

**Bundle another production business renderer into Electron.** Rejected because page changes would require coordinating two business releases and maintaining duplicate server-action adapters.

**Expose the native preload to remote business pages.** Rejected because business pages need server-authorized capabilities and must not gain the local filesystem or credential APIs.

**Place a bearer token in the business URL.** Rejected because URLs enter browsing history, referrals and server logs. The Next BFF owns its authenticated browser session.

## Consequences

The native supervisor records delegated expiry separately from credentials. Prompt admission renews an expired idle runtime and restores authorized durable sessions. It does not replace a runtime while a reply is active or retry an operation after a server refusal. Source revocation remains authoritative even before delegated expiry.

The tool adapter separately renews expired Host-managed capability leases by attaching the same Run, Session and installation. It shares concurrent renewal and refuses stale lease responses before sending operations. Externally configured leases are not replaced.

Host-managed restoration brackets ordered, authorized ACP notifications with replay frames. The renderer replaces its transcript before replay and preserves queued live prompt display overrides. Finalized message blocks are detached from the mutable accumulator so snapshot freezing cannot prevent subsequent streaming. Historical replies stay finalized during later prompts; streaming applies only after the latest user message.

`DSH_DESKTOP_BUSINESS_WEB_URL` is an HTTPS root origin. `DSH_DESKTOP_USER_DATA` provides an absolute isolated application data directory for acceptance runs. A business-origin outage prevents these pages from loading. Shared spaces currently list entitled applications and do not provide document collaboration.

Navigation revisions cover page authorization and loading, so a superseded request cannot replace or hide the current view. Directory refresh is independent of navigation admission. Composer candidates reuse validated display metadata and coalesce background refreshes; the server remains authoritative for every page read and tool execution. Child panels measure the hovered row and clamp their height within the viewport.

Unsent empty sessions have no durable log. Prompt admission recreates the owned empty session after renewal and sends the serialized input once; logged sessions restore normally.

## Testing

`apps/desktop/tests/business-window.spec.ts` verifies invalid origins, isolated sessions, absence of preload, off-origin navigation refusal and scoped Module URLs. Desktop login and golden-page tests cover native authority reads. Actual startup, authenticated Next pages and Web/Preview/Desktop comparisons require separate runtime evidence.

Business entry changes retain the visible remote view while Next handles same-origin routes. Startup prepares the initial document behind chat. This keeps business loading independent of conversation visibility; server requests still validate current authority.
