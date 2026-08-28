# Agent Note: Electron desktop sidecar and stdio Fetch carrier

Status: implemented

English | [中文](2026-08-28-electron-desktop-sidecar-and-stdio-fetch.zh.md)

## Problem

The existing Web application already exposes the Agent, Session, tools, settings, and event streams through the typed API gateway, but its product composition assumes an HTTP server and a browser client. An Electron desktop application needs to reuse that Host behavior while keeping Agent execution, native modules, filesystem access, and process ownership outside the sandboxed Renderer. Running the existing Web server inside a desktop shell would also retain a loopback port and its origin/trust policy even though the processes already share a supervised parent-child relationship.

The desktop proof of concept must establish the process split and transport before product interface migration can begin. It needs two independent long-lived event streams, concurrent unary calls, per-request cancellation, explicit Host startup and shutdown, and a narrow preload surface without defining a second business API.

## Decision

`apps/desktop` is an Electron application with three authority levels. The main process owns the window, the `dsh-app://` resource protocol, IPC admission, and one independently spawned ordinary Node Agent Host. The context-isolated, sandboxed preload exposes only request start, response resume, request cancellation, frame subscription, and Host restart. The Renderer has no Node integration and consumes the existing `AbstractApiClient` API.

The Agent Host starts the repository CLI with the Web profile plus `apps/desktop/host.patch.yml`. The overlay retains Host services and presets, disables the HTTP server and browser-client plugins, selects the native directory picker, and mounts `@deepseek-ai/dsh-host-apiproxy/stdio-plugin`. This is a technical-preview composition rather than a distributable application bundle: the child currently starts from repository source and installed workspace dependencies.

`@deepseek-ai/dsh-host-apiproxy` owns version 1 of a dedicated newline-delimited JSON stdio Fetch carrier. The main process and Host exchange `hello`/`ready` before requests. Request ids multiplex concurrent metadata, base64 response-body chunks, completion, errors, and cancellation over one connection. The carrier accepts only `/api/` paths, forwards request bodies without interpreting API envelopes, maps each cancel frame to that request's `AbortController`, and aborts all active requests when input closes. A protocol-version mismatch is fatal; there is no compatibility fallback.

Response metadata and body delivery are split deliberately. The main process buffers body frames until the Renderer has constructed its `ReadableStream` and sends resume, preventing a fast unary response from racing ahead of the stream consumer. Cancellation listeners remain installed until the matching response body ends or errors, so aborting a long-lived event stream still reaches the Host after response headers arrive.

The main process serves Renderer assets through a privileged application protocol with a restrictive content-security policy, rejects navigation and new windows, and accepts desktop IPC only from that protocol's application origin. Host startup has a fixed handshake timeout. Normal application shutdown closes stdin, sends `SIGTERM`, waits for process exit, and uses `SIGKILL` only after the bounded shutdown interval.

## Alternatives considered

**Run the Agent Host inside Electron's main process.** This removes one process and one carrier, but an Agent crash, native module failure, or blocking tool would share the window lifecycle. It would also make Electron's embedded Node ABI the Host runtime. Independent ordinary Node execution preserves fault containment and the repository's existing runtime assumptions.

**Load Agent code in the Renderer.** This would provide direct UI calls, but it would require Node integration or broad preload primitives and would place process, filesystem, and credential authority in the least-trusted process. The Renderer remains an API consumer instead.

**Keep the loopback HTTP server.** This would reuse the Web carrier unchanged, but it retains port allocation, origin checks, and local-server lifecycle for two processes with a direct supervised channel. The stdio carrier reuses the same Fetch handler without introducing a network listener.

**Define an Electron-specific business protocol.** Typed IPC methods could mirror every API operation, but that would duplicate request schemas, event semantics, timeout rules, and future methods. Carrying opaque Fetch requests leaves `ApiProxy` and `AbstractApiClient` as the only business protocol owners.

## Verification

The stdio carrier tests exercise concurrent independent response streams, matching-request cancellation, and fail-closed version negotiation. The desktop build type-checks the main, preload, and Renderer faces separately, bundles the preload as CommonJS for Electron's sandbox, and bundles the main process with Electron externalized.

A runtime smoke starts the real Host composition through the overlay, completes the version handshake, calls `host.describe`, opens `events.mux` and `events.host` concurrently, and cancels them independently. The Electron preview has also been launched against that Host and displays the ready state and Host description through the sandboxed Renderer.

## Consequences

- The desktop work can reuse Host plugins and typed API methods while replacing the Web server and browser transport.
- Transport framing is now a published subpath of `dsh-host-apiproxy`; its version must change when frame compatibility changes.
- The Electron main process remains a transport and lifecycle owner, not a second API gateway.
- The current preview requires repository source, workspace dependencies, and a suitable ordinary Node executable.
- Packaging Node and native modules into a `.app`, signing, notarization, DMG generation, updates, recovery policy, first-run experience, and the full product interface remain outside this implemented slice.
