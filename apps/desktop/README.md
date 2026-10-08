# Orbis AI Desktop technical preview

English | [中文](README.zh.md)

This application is the macOS Electron technical preview. Its product identity is Orbis AI in window chrome, the sidebar, the blank-session hero, permission dialogs, and the Desktop-owned model persona. Its main process starts an independent standalone ACP Runtime through stdio and exposes only typed Session operations to the Renderer without opening a local TCP port.

## Process ownership

The Electron main process owns the window, the `dsh-app://` resource protocol, IPC admission, and ACP Runtime supervision. Its Renderer is sandboxed with context isolation and no Node integration. The preload exposes fixed workspace, Session, Skill import, attachment staging, artifact preview and export, model settings, MCP settings, and Runtime operations; it does not expose generic IPC, filesystem, shell, or process primitives.

In source mode, the main process uses `@deepseek-ai/dsh-acp-client` to launch the built ACP example Runtime. `DSH_DESKTOP_ACP_COMMAND` and `DSH_DESKTOP_ACP_ARGS_JSON` replace that command when a different Runtime is required. In a packaged application it instead resolves the bundled Node executable, ACP entry, and configuration below `process.resourcesPath`. It maps ACP Session updates into display frames and presents ACP permission choices; the Runtime still owns permission policy and sandbox enforcement.

Desktop runs Code and Work as one automatic task surface: the Runtime infers the request type and loads the relevant bundled development, web-research, document, or spreadsheet Skill. Artifact-producing tasks also load the bundled delivery-verification Skill, whose final acceptance routes by deliverable type and repeats inspect, repair, and re-check until the current artifact passes or a concrete blocker remains. Shell and filesystem capabilities are shared. Web search uses You.com's direct search API and needs `YDC_API_KEY`, independently of the primary chat model's OpenAI-compatible endpoint. LSP and binary office formats are used only when a deployment supplies the corresponding provider or tool.

## Run the preview

Use Node 22.19 or 24 or newer, install workspace dependencies, then run:

```sh
pnpm run desktop
```

The command builds the Host libraries and Electron application before opening the window. Set `DSH_DESKTOP_NODE` to an ordinary Node executable when the Electron main process cannot inherit a suitable one.

## Build the unsigned application

Use a supported Node version on macOS, install workspace dependencies, then run:

```sh
pnpm run dist:desktop
pnpm run verify:desktop-dist
```

The build downloads the pinned official Node 24.18.1 archive for the host architecture, checks its SHA-256 digest, deploys a symlink-free Runtime dependency tree, and writes `apps/desktop/dist-electron/mac-<arch>/Orbis AI.app`. The verification copies that application outside the repository and starts it with no external Node or package-manager path; the embedded ACP Runtime must initialize and answer a Session query. This verifies relocation and offline startup on the build Mac. A separate physical Mac of the same architecture remains the release acceptance environment.

## Current scope

- The main process supervises one independent ACP Runtime and terminates it before quitting. Runtime notifications are discarded after the renderer window is destroyed.
- Session list and load use the Runtime's durable ACP operations; loading replays presentation updates.
- Session close releases the live handle without deleting durable history.
- The technical Renderer can create and load Sessions, submit a prompt, cancel the active turn, answer permission requests, and display streamed text, expanded live reasoning, and rendered tool cards from ACP updates. Prompt rejection remains visible in the composer instead of appearing as an unanswered message. Saving an OpenAI-compatible primary model first verifies a text request with function tools, then detects optional image input and any context or output capacities advertised by the endpoint. Known OpenAI model ids inherit their installed effort metadata; unknown models send no guessed reasoning effort and use conservative token capacities when the endpoint provides none. Settings keep Computer Use off until explicitly enabled; it uses a local Chromium DevTools endpoint when available or macOS Accessibility otherwise, while screenshots and every input action still request approval. Screenshot inspection also requires the capability check to accept image input, and native capture requires macOS Screen Recording permission. The embedded ACP image store admits one large canvas capture at a time up to 201,326,592 source pixels and 32,768px per side, then normalizes its long edge to 2048px before it enters durable model-visible history.
- Routine prompts run directly. A substantial Desktop task creates one persisted same-session goal, publishes a three-to-seven-item task list, and continues across Goal Rounds until the Runtime records completion or a concrete blocker. The task strip follows ACP plan updates and clears when the next human turn begins.
- The hidden-titlebar header is a native drag region, so dragging its empty top strip moves the window. The composer add menu exposes attachment upload and a hover-opened Skills catalog. Skills and pasted file or folder references render as padded neutral capsules directly in the draft; users can place and repeat them between ordinary words, and the submitted ACP prompt preserves each reference at that position. The sent and replayed user message preserves each attachment label and position as the same file capsule without exposing its local URI. The picker stages PNG/JPEG/WebP/GIF images and ordinary text/code/Markdown/HTML/JSON/CSV files. Images selected there are sent as ACP image blocks to the configured vision-capable OpenAI-compatible model. Pasting files or folders does not copy or recursively scan them; the Runtime receives their absolute paths as resource links so tools can inspect or operate on the selected items. A clipboard image without a source path is saved inside the Session inputs first and then sent as a resource link. Attachment inspection uses inline vision, filesystem, `read_image`, or document tools; it does not load Computer Use unless the request requires a live application, browser, or desktop. Plain-text paste remains the normal composer operation. Imported user Skills live below `~/.dsh/skills` and are removable from Settings; project and bundled Skills are read-only there.
- Each turn copies created or changed ordinary files into `<workspace>/.dsh/artifacts/<session>/turn-NNNN/`, writes a Session manifest, and displays the resulting files after the final response. The file cards show the format and an open-method menu for the system default application, the owned preview panel, or Finder. Their context menu can reveal the file, copy its path, or add it to the active composer as the same reference capsule used for user attachments. Browser-native artifacts open automatically in a resizable right-side preview; HTTP and HTTPS links use the same browser panel. Collapsing the panel preserves the current tab and resets full-screen mode, while closing the tab or starting a new Session clears it. Formats Chromium cannot render retain an explicit system-application action. A user can export all Session artifacts as ZIP. Binary office-format generation remains outside this scope.
- Settings can add, edit, and remove stdio or Streamable HTTP MCP servers. The owner-only Desktop document is shared with the Runtime; direct UI edits restart it, while the approved `mcp_config` tool lets a user ask the Agent to configure the same list. Connected tools remain available to later Sessions under `mcp__<server>__<tool>` names.

The generated `.app` contains Node, the ACP Runtime, its configuration, JavaScript dependencies, and macOS native helpers. It is deliberately unsigned: macOS may require an explicit user override, and the application is not suitable for public distribution. Code signing, notarization, DMG generation, universal binaries, automatic updates, crash recovery, a first-run flow, and the full product interface remain later work.

## OBIS business pages

Set `DSH_DESKTOP_BUSINESS_WEB_URL` to the HTTPS OBIS Next.js origin. The shared Mona/Harness sidebar places OBIS applications, spaces and knowledge above conversation workspaces and history. Business pages occupy a sandboxed WebContentsView in the existing window's right workspace. Selecting a conversation restores the mounted chat, composer and local session state.

Desktop Main obtains an opaque Web session from `/v1/desktop/business-session` using its human OBIS identity and installs a Secure, HttpOnly cookie. No native bearer, preload or Node API reaches the remote page. Opening an entry checks native credential readiness while Next validates its source-bound session; published Module navigation refreshes independently. Native logout clears the linked cookie; source-session revocation invalidates subsequent Next requests. A Web redirect to sign-in hides the business view and reports a business login prompt without reloading chat. Scope and page authorization remain server-owned.

`DSH_DESKTOP_USER_DATA` selects an absolute isolated acceptance directory. The older DOM renderer remains for preview consumers; published business pages use the Next React runtime. Public spaces currently list entitled applications rather than collaborative documents.

Native identity issues and consumes a human-approved Workspace launch ticket for the validated scope before ACP startup. Only delegated access reaches the supervised Host credential provider; human access and refresh tokens stay in Desktop Main. The ACP composition mounts the governed OBIS tool adapter, including bounded SSE reads. Ordinary workspace runs are not Module-bound; controlled Module actions and automatic Run completion require separate acceptance.

Desktop Main checks delegated expiry before sending each prompt. An expired idle runtime obtains a new ticket and reloads its authorized durable sessions before accepting the prompt. Concurrent callers share renewal; an active reply prevents runtime replacement. A server refusal during a sent prompt remains a failure and does not trigger an automatic operation retry.

Host replay frames replace the displayed transcript before restoring history. Authorized message notifications are delivered in order before replay completion; unsent display overrides are reserved for the subsequent live prompt. Published message blocks are detached from the mutable display accumulator. Historical replies remain finalized while only the current turn streams.

The composer plus menu reuses the Skills submenu and reference pipeline for fixed business areas and authorized published Module pages. Reference labels remain in sent and replayed text; only non-secret selection metadata reaches the durable prompt. The OBIS adapter creates a separate version-pinned Run for an explicitly selected Module. Ordinary conversations remain read-only; selected Module proposals require one-shot human confirmation and current Kernel authorization. A stale version or cross-workspace reference fails before a business operation.

Business navigation applies only the latest selection; cancelled older loads cannot close its replacement. Business directory refresh runs independently of page loading. The composer uses the validated sidebar directory immediately and shares background refreshes. Child menus align with their hovered row and remain inside the viewport. Display metadata grants no authority: Next requests and Kernel tools check current access.

Unsent empty sessions have no durable log. Prompt admission recreates the owned empty session after renewal and sends the serialized input once; logged sessions restore normally.

## Model selection

In Settings → Model API, enter the endpoint and key, then choose **Detect models** to retrieve its OpenAI-compatible `GET /models` directory. A directory containing one or several models is selectable before saving. After saving, the composer shows the current model to the left of Send; its menu can refresh the directory and select another model. Switching verifies the model and reconnects the managed Runtime before subsequent or restored conversations use it. Wait for active replies to finish before switching. An unavailable directory preserves the manually configured model and shows a warning; listing alone does not prove inference access.

Authenticated startup prepares the first business document behind chat. Business entry changes keep the view visible and dispatch validated same-origin routes to Next; the initial document uses normal navigation when no Next handler is mounted.

Valid linked Web sessions are reused without decrypting native credentials or rewriting the browser cookie on each navigation. Credential rotation updates the cookie through the identity owner; logout and server sign-in redirects clear it.
