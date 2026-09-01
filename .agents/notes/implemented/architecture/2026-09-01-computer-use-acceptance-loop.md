# Target-aware Computer Use and outcome acceptance

Implemented by `feat/computer-use-acceptance-loop`.

## Boundary

Computer Use remains a layered capability: the `computer` Runtime routes explicit native-app, browser-tab, and desktop targets to Providers; one model-facing `computer` tool is the Consumer; `computer-use` is the interaction policy Skill. The Agent loop is unchanged.

The implementation deliberately does not add a universal completion validator, per-gesture tools, OCR/CV location services, a native daemon, macros, or a persistent GUI scheduler.

## State and action contract

Observations are accessibility-first and can request `accessibility`, `visual`, or `both`. Element identifiers belong to one observation and expire after state-changing actions. Providers return a fresh observation after mutation. App-scoped visual capture fails honestly when the provider cannot produce app-window pixels; a desktop screenshot is never relabelled as an app capture.

The single tool exposes `list`, `observe`, `click`, `drag`, `set_value`, `type_text`, `paste`, `key`, `scroll`, and `secondary_action`. Stable capability/error boundaries include permission, target, window, stale-element, unsupported-action, and capture failures.

## Interaction policy

Tool priority is direct connector/API/CLI before Accessibility Computer, then Visual Computer. Semantic elements are preferred to coordinates, every mutation is followed by fresh state, failed or unchanged actions are re-observed rather than blindly repeated, visible UI content is untrusted, and stopping is based on authoritative outcome evidence rather than gesture success.

## Outcome evidence

The existing delivery-quality policy now scales verification by outcome instead of treating every task as an artifact: read-only answers use authoritative information; code/file mutations use final state plus focused deterministic checks; external/UI mutations use fresh post-action external state; produced artifacts use type-specific final acceptance and `delivery-verification` when available. Existing Goal completion behavior is preserved and regression-tested rather than replaced by another completion framework.

## Verification

Keyless ACP replay snapshots retain the feature-off baseline. Explicit composition tests pin all Computer components behind `DSH_DESKTOP_COMPUTER_USE_ENABLED`. Computer provider/tool tests cover target routing, stale identity, action vocabulary, fresh observations, permission/error mapping, visual-capture honesty, and short-lived diff state. A path-scoped macOS PR workflow runs the focused regressions, stages the Desktop runtime, and executes `verify:desktop-dist` on macOS.
