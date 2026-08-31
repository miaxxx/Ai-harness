# `@deepseek-ai/dsh-computer-browser-cdp`

English | [中文](README.zh.md)

Chromium DevTools Protocol provider for [`dsh-computer`](../computer/README.md). Set `DSH_BROWSER_CDP_URL` to a local browser endpoint, such as `http://127.0.0.1:9222`; the provider lists page targets and controls only the selected target through structured DevTools commands. Cancelling the active turn closes its connection and rejects pending inspection or screenshot commands.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-computer`.

#### KV Cache effect

The Provider adds no context of its own; the consumer tool owns the durable result and cache behavior.

## Known Limitations and Deferred Work

- The browser must be started with local remote debugging enabled. The provider does not launch a browser, traverse login prompts, or grant filesystem, shell, or native-app access. Each mutating action remains subject to the `computer` tool's user approval.
