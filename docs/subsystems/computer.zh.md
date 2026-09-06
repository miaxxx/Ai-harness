# 受控 Computer Use

[English](computer.md) | 中文

电脑控制能力是一项[能力 seam](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.zh.md)，包含一个 `ctx.computer` 服务、按目标路由的浏览器与 macOS Provider，以及面向模型的 `computer` 工具。服务把每个原生应用、浏览器标签页或完整桌面目标路由到有能力处理它的 Provider。Provider 负责有界观察和固定输入动作；工具负责授权、按 Agent 隔离的短生命周期观察状态、持久截图附件存储和展示。

源码：[`packages/computer/computer/src/types.ts`](../../packages/computer/computer/src/types.ts)

## 观察与操作

一次观察只标识一个目标，可以包含有界辅助功能状态、如实标注范围的像素，或同时包含两者。元素 id 只属于一个 Agent 与目标的最新观察；工具会拒绝虚构、过期和跨 Agent 的 id，在分派已批准动作前让它失效，并在动作成功后返回 Provider 的最新状态。Provider 不会接收非结构化的模型代码。

`dsh-computer-browser-cdp` 操作本机 Chromium DevTools 端点已经暴露的浏览器标签页目标，不会启动浏览器。`dsh-computer-macos` 通过固定 JXA、辅助功能、Core Graphics 和 `screencapture` 操作控制原生应用与完整桌面。原生语义控制需要辅助功能权限，桌面像素需要屏幕录制权限。Desktop 设置负责启用该能力。视觉观察和输入动作使用授权服务；桌面 ACP 可以保留显式 `computer` 授权，直至当前活动任务关闭。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
