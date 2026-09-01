# computer/ — controlled local computer use

English | [中文](README.zh.md)

This family provides one target-aware Computer Use service for local browser tabs, native applications, and the desktop. Providers stay platform-specific, while `ctx.computer` routes each explicit target to a compatible Provider and returns fresh observations after actions. Provider preference is only a same-target-kind tie-breaker; it does not hide other target kinds.

| Package | Role | ctx key |
|---|---|---|
| [`computer/`](computer/README.md) | Defines target kinds, observation/action vocabulary, stable errors, Provider registration, and target-aware routing | `ctx.computer` |
| [`computer-browser-cdp/`](computer-browser-cdp/README.md) | Observes and operates explicit Chromium page targets through CDP | registers on `ctx.computer` |
| [`computer-macos/`](computer-macos/README.md) | Observes and operates macOS app/desktop targets through Accessibility plus bounded native input | registers on `ctx.computer` |
| [`tool-computer/`](tool-computer/README.md) | Exposes the single approved `computer` tool, observation-scoped element ids, fresh post-action state, and model-facing semantic diffs | registers on `ctx.tools` |

Computer Use is state-based rather than macro-based: prefer semantic accessibility state, use visual/coordinate interaction only when needed, treat element ids as observation-scoped, and decide the next action from current post-action evidence. The bundled `computer-use` Skill owns those model-facing operating rules; the delivery-quality policy owns outcome-level completion evidence.

The [Desktop computer-use decision](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.md) records why browser DevTools and macOS Accessibility remain separate providers behind one service. The [subsystem reference](../../docs/subsystems/computer.md) owns the shared vocabulary.
