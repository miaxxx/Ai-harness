# Controlled Computer Use

English | [中文](computer.zh.md)

The computer-control capability is a [capability seam](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.md) with one `ctx.computer` service, interchangeable browser and macOS providers, and the model-facing `computer` tool. The service owns provider selection and a bounded snapshot vocabulary. Providers own how one app or browser tab is inspected and acted on; the tool owns approvals, durable screenshot attachment storage, and presentation.

Source: [`packages/computer/computer/src/types.ts`](../../packages/computer/computer/src/types.ts)

## Snapshot and actions

A snapshot identifies one selected app, carries bounded visible text and at most eighty accessible elements, and may include one attachment-backed screenshot. Element ids are short-lived: the model lists apps, inspects one, acts through an approval, then inspects again before relying on another id. A provider never receives unstructured model code.

`dsh-computer-browser-cdp` operates a browser already exposing a local Chromium DevTools endpoint; it does not launch a browser. `dsh-computer-macos` sends fixed JXA Accessibility operations and needs macOS Accessibility permission; its screenshots additionally need Screen Recording permission. The Desktop setting selects the capability, while each screenshot or input action retains the session's one-shot approval.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputer--computerruntime"></a>

### `ctx.computer` — `ComputerRuntime`

Registry and execution owner for exactly one configured local computer Provider.

```ts cordis-catalog
/**
 * Register one local computer Provider.
 * @param provider - provider implementation identified by its stable id.
 * @returns disposer that removes the provider.
 */
register(provider: ComputerProvider): () => void

/**
 * List apps exposed by the selected Provider.
 * @param signal - cancellation signal for provider work.
 * @returns visible app identifiers and labels.
 */
listApps(signal?: AbortSignal): Promise<readonly ComputerApp[]>

/**
 * Inspect one selected app.
 * @param app - Provider app id returned by {@link listApps}.
 * @param includeScreenshot - whether the snapshot includes pixels.
 * @param signal - cancellation signal for provider work.
 * @returns a bounded current app snapshot.
 */
inspect(app: string, includeScreenshot: boolean, signal?: AbortSignal): Promise<ComputerSnapshot>

/**
 * Perform one bounded app action through the selected Provider.
 * @param app - Provider app id returned by {@link listApps}.
 * @param action - fixed input operation to perform.
 * @param signal - cancellation signal for provider work.
 * @returns the app snapshot after the action.
 */
act(app: string, action: ComputerAction, signal?: AbortSignal): Promise<ComputerSnapshot>
```

Source: [`packages/computer/computer/src/index.ts`](../../packages/computer/computer/src/index.ts)
<!-- END GENERATED cordis-surface -->
