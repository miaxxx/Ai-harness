# `@deepseek-ai/dsh-computer-macos`

English | [中文](README.zh.md)

macOS Provider for `dsh-computer`. It observes native applications through bounded recursive Accessibility traversal, executes only fixed JXA/CoreGraphics operations, and uses `screencapture` only for full-desktop visual observation. macOS must grant Accessibility; screenshots also require Screen Recording. Observation and capture honor the active turn's cancellation signal. The model never supplies executable JXA.

The Provider supports native `app` and `desktop` targets. App observations are semantic/accessibility-first and return observation-scoped element ids. Supported mutations include semantic element actions plus bounded coordinate click/drag and desktop scrolling; every mutation is followed by a fresh accessibility observation. When window-scoped pixels are unavailable, the Provider returns `WINDOW_UNAVAILABLE` instead of mislabeling a full-desktop screenshot as an application image.

Stable platform failures are surfaced through the Computer error vocabulary, including `COMPUTER_PERMISSION_REQUIRED`, `TARGET_NOT_FOUND`, `WINDOW_UNAVAILABLE`, `ELEMENT_EXPIRED`, `ACTION_UNSUPPORTED`, and `CAPTURE_FAILED`.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-computer`.

#### KV Cache effect

The Provider adds no context of its own; the consumer tool owns model-visible observations, short-lived state, and diff rendering.

## Known Limitations and Deferred Work

- **Window-scoped visual capture** — this Provider intentionally does not claim app/window screenshots until an honest window-scoped capture implementation exists. Visual app work can use another suitable Provider or remain semantic when accessibility state is sufficient.
- **Accessibility coverage** — custom controls without useful accessibility semantics may require the tool's coordinate fallback, which should be driven from fresh visual evidence rather than stale pixels.
