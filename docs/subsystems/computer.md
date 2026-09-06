# Controlled Computer Use

English | [中文](computer.zh.md)

The computer-control capability is a [capability seam](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.md) with one `ctx.computer` service, target-aware browser and macOS Providers, and the model-facing `computer` tool. The service routes each native-application, browser-tab, or Desktop target to a capable Provider. Providers own bounded observations and fixed input actions; the tool owns approvals, short-lived per-Agent observation state, durable screenshot attachment storage, and presentation.

Source: [`packages/computer/computer/src/types.ts`](../../packages/computer/computer/src/types.ts)

## Observations and actions

An observation identifies exactly one target and may contain bounded accessibility state, truthful-scope pixels, or both. Element ids belong only to the latest observation for one Agent and target; the tool rejects invented, expired, and cross-Agent ids, invalidates them before dispatching an approved action, and returns fresh Provider state after success. A Provider never receives unstructured model code.

`dsh-computer-browser-cdp` operates browser-tab targets already exposed by a local Chromium DevTools endpoint; it does not launch a browser. `dsh-computer-macos` operates native applications and the complete Desktop through fixed JXA, Accessibility, Core Graphics, and `screencapture` operations. Native semantic control needs Accessibility permission, while Desktop pixels need Screen Recording permission. The Desktop setting enables the capability. Visual observations and input actions use the approval service; Desktop ACP can retain an explicit `computer` grant until the active task closes.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputer--computerruntime"></a>

### `ctx.computer` — `ComputerRuntime`

Registry and deterministic target-aware router. Providers remain stateless across calls.

```ts cordis-catalog
/**
 * Register one target-aware Provider for the lifetime of the returned disposer.
 * @param provider - Provider whose id must be unique in this runtime.
 * @returns a disposer that removes exactly this Provider registration.
 */
register(provider: ComputerProvider): () => void

/**
 * List currently visible targets from every usable Provider.
 * @param kind - Optional target category filter applied to Providers and results.
 * @param signal - Optional cancellation signal forwarded to every selected Provider.
 * @returns the combined current target list.
 */
async listTargets(kind?: ComputerTargetKind, signal?: AbortSignal): Promise<readonly ComputerTarget[]>

/**
 * Observe a named target directly; discovery is not a prerequisite.
 * @param target - Exact target to route by category.
 * @param mode - Requested semantic, visual, or combined state.
 * @param signal - Optional cancellation signal forwarded to the selected Provider.
 * @returns fresh bounded state for the target.
 */
observe(target: ComputerTarget, mode: ComputerObservationMode = 'accessibility', signal?: AbortSignal): Promise<ComputerObservation>

/**
 * Perform one bounded action through the target's Provider.
 * @param target - Exact target to route by category.
 * @param action - Input operation to perform.
 * @param signal - Optional cancellation signal forwarded to the selected Provider.
 * @returns fresh Provider-produced state after the action settles.
 */
perform(target: ComputerTarget, action: ComputerAction, signal?: AbortSignal): Promise<ComputerObservation>
```

Source: [`packages/computer/computer/src/index.ts`](../../packages/computer/computer/src/index.ts)
<!-- END GENERATED cordis-surface -->
