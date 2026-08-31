# Agent Note: Desktop controlled computer use

Status: implemented

English | [中文](2026-08-30-desktop-computer-use.zh.md)

## Problem

Desktop sessions could use filesystem, shell, and Web search tools but could not inspect or operate a browser or native application when a task genuinely required visible UI verification. Giving the model unrestricted keyboard, mouse, or script execution would make that gap unsafe to close.

## Decision

**`ctx.computer` is the provider-selected computer-control capability, and `computer` is its single approval-aware model consumer.**

- `dsh-computer` owns app discovery, bounded snapshots, and small input actions. Providers return temporary element ids and the service selects one configured usable provider rather than relying on registration order.
- `dsh-computer-browser-cdp` uses a local Chromium DevTools endpoint when `DSH_BROWSER_CDP_URL` is present. It inspects a selected page and sends only fixed DevTools operations; it does not launch a browser or run model-authored scripts. Turn cancellation closes the scoped connection and rejects pending commands.
- `dsh-computer-macos` uses fixed JXA Accessibility operations for the selected app. It never interprets model text as JXA. macOS grants Accessibility and Screen Recording permissions to the ACP Runtime process, and screenshot capture shares the active turn's cancellation signal.
- `dsh-tool-computer` asks through `ctx.approval` for each screenshot, click, entry, key press, and scroll. Text-only inspection stays read-only. Screenshots pass through `ctx.attachments`, so their model-visible pixels are durable tool-result content.
- Desktop keeps Computer Use off until the user enables it in the primary-model settings. A local DevTools endpoint takes precedence over macOS visual control; each mutating action still reaches the existing ACP approval UI. The Renderer mounts the generic tool-card surface used by `computer` and other ACP tools, and it retains prompt failures in the conversation snapshot so a rejected request is visible.

## Alternatives considered

**A direct model-to-AppleScript bridge.** Rejected: accepting arbitrary JXA would make the model's response a host command language and would not preserve a narrow operation vocabulary.

**Coordinate-only GUI automation.** Rejected as the primary path: accessibility and DevTools elements are inspectable and survive ordinary layout variation. Coordinate fallback remains deferred for controls with no useful accessibility surface.

**Persistent per-application grants.** Rejected for the initial Desktop capability: a one-shot approval keeps the visible action and user decision adjacent while the product establishes a reliable permission experience.

## Consequences

Browser tasks use structured DevTools automation when a user starts a local debugging endpoint. Native macOS tasks use Accessibility only after the user enables the feature and grants the operating-system permissions. The model re-inspects after every action because element ids expire. The design adds no process, filesystem, or terminal authority beyond existing tools; it costs a confirmation for each sensitive operation and leaves visual-coordinate fallback outside this capability.
