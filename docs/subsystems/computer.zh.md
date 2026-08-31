# 受控 Computer Use

[English](computer.md) | 中文

电脑控制能力是一项[能力 seam](../../.agents/notes/implemented/feature/2026-08-30-desktop-computer-use.zh.md)，包含一个 `ctx.computer` 服务、可互换的浏览器与 macOS Provider，以及面向模型的 `computer` 工具。服务拥有 Provider 选择和受限快照词汇。Provider 拥有对一个应用或浏览器标签页的检查和操作方式；工具拥有授权、持久截图附件存储和展示。

源码：[`packages/computer/computer/src/types.ts`](../../packages/computer/computer/src/types.ts)

## 快照与操作

快照标识一个选中的应用，携带受限的可见文本和最多八十个可访问元素，并可包含一个以附件为后端的截图。元素 id 生命周期很短：模型列出应用，检查其中一个，经授权操作，再在依赖另一个 id 前重新检查。Provider 不会接收非结构化的模型代码。

`dsh-computer-browser-cdp` 操作已经暴露本机 Chromium DevTools 端点的浏览器，不会启动浏览器。`dsh-computer-macos` 发送固定 JXA 辅助功能操作，需要 macOS 辅助功能权限；截图还需屏幕录制权限。Desktop 设置负责选择该能力，每次截图或输入操作仍保持会话的一次性批准。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
