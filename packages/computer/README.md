# computer/ — controlled local computer use

English | [中文](README.zh.md)

This family provides provider-neutral inspection and small, approval-mediated input operations for a local browser or desktop application.

| Package | Role | ctx key |
|---|---|---|
| [`computer/`](computer/README.md) | Defines provider registration, selection, and computer vocabulary | `ctx.computer` |
| [`computer-browser-cdp/`](computer-browser-cdp/README.md) | Inspects and operates a locally exposed Chromium DevTools page | registers on `ctx.computer` |
| [`computer-macos/`](computer-macos/README.md) | Inspects and operates a macOS Accessibility application | registers on `ctx.computer` |
| [`tool-computer/`](tool-computer/README.md) | Exposes approved inspection and input operations to the model | registers on `ctx.tools` |

The [Desktop computer-use decision](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.md) records why browser DevTools and macOS Accessibility remain separate providers behind one service. The [subsystem reference](../../docs/subsystems/computer.md) owns the shared vocabulary.
