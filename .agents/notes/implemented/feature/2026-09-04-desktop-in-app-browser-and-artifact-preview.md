# Agent Note: Desktop in-app browser and artifact preview

Status: implemented

English | [中文](2026-09-04-desktop-in-app-browser-and-artifact-preview.zh.md)

## Problem

Desktop displayed generated files after a turn but handed every click to an external application. HTML artifacts therefore left the task, and ordinary web links had no product-owned browsing surface. The product also had no automatic presentation step after creating a visual artifact.

## Decision

Desktop owns one right-side browser and artifact-preview panel. The same controller receives produced-file clicks, automatic post-turn artifact selection, and HTTP or HTTPS navigation from the product Renderer. HTML, PDF, images, and browser-readable text formats render in an Electron `webview`; unsupported office formats remain visible in the panel with an explicit system-application action. Directories still open through the operating system.

The panel opens at about 42 percent of the content width with a bounded minimum and maximum. Its left divider supports pointer dragging and keyboard resizing without a panel shadow. Top-right controls expand the preview to the full content area or collapse it, and the closed state uses the left-sidebar panel icon mirrored horizontally at the same screen position as the open-state control. Collapsing preserves the active tab but resets full-screen mode; the tab close control and a newly created Session clear it. The blank page retains the address bar and presents a centered browsing prompt.

Generated files render as per-file cards with a format label, an open-method menu for the system default application, the preview panel, and Finder, plus a ZIP export action. A card context menu opens its containing folder, copies its path, or adds that exact path to the active composer through the existing attachment-reference pipeline. This keeps generated-file citations visually and semantically identical to user-provided file references without reading unrelated clipboard content.

The main process prepares local file targets and admits only HTTP, HTTPS, `about:blank`, and trusted local artifact URLs. Attached WebViews receive no preload or Node integration, keep context isolation, sandboxing, web security, and blocked permission requests, and cannot create a separate popup window. The Renderer receives fixed preview and external-open operations instead of generic navigation or filesystem IPC.

## Alternatives considered

**Always use the system browser.** This preserves a smaller Desktop shell but removes task context and cannot automatically present the completed artifact beside the conversation.

**Serve artifacts from a local HTTP endpoint.** This adds listener lifecycle and origin policy to solve a local Desktop problem that `file://` already handles. The isolated WebView does not share the product Renderer origin.

**Build format-specific viewers for office files.** Chromium cannot faithfully render those formats, and adding document conversion belongs to the document capabilities rather than the preview surface. The panel states the limitation and retains the system-app action.

## Verification

Focused tests cover URL admission, automatic artifact selection, browser-native and external-only file routing, directory handoff, and preview state. The Desktop typecheck and production build compile the main process, preload, controller, overlay, and WebView configuration together. A real Electron run verifies the mirrored launcher, panel opening, HTTP navigation, in-panel link navigation, width separator, full-screen control, collapse control, stable control position, and blank-page state.

## Consequences

- Generated browser-native artifacts can appear automatically without leaving the task.
- File clicks and web links share one Desktop-owned preview path.
- The panel is resizable and reversible without adding a second workspace or browser subsystem, and a collapsed panel restores its active artifact.
- Generated artifacts can be referenced again from the composer without copying them or scanning their parent directory.
- Web clients retain their Host-opening behavior; this decision is Desktop-specific.
