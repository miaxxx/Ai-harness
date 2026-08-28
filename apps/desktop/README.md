# DeepSeek Harness Desktop technical preview

English | [中文](README.zh.md)

This application is the phase-zero macOS Electron proof of concept. Its main process starts an independent standalone ACP Runtime through stdio and exposes only typed Session operations to the Renderer without opening a local TCP port.

## Process ownership

The Electron main process owns the window, the `dsh-app://` resource protocol, IPC admission, and ACP Runtime supervision. Its Renderer is sandboxed with context isolation and no Node integration. The preload exposes workspace lookup, Session list/create/load/close, prompt/cancel, frame subscription, and Runtime restart; it does not expose generic IPC, filesystem, shell, or process primitives.

The main process uses `@deepseek-ai/dsh-acp-client` to launch the built ACP example Runtime by default. `DSH_DESKTOP_ACP_COMMAND` and `DSH_DESKTOP_ACP_ARGS_JSON` replace that command when a different Runtime is required. It maps ACP Session updates into display frames and presents ACP permission choices; the Runtime still owns permission policy and sandbox enforcement.

## Run the preview

Use Node 22.19 or 24 or newer, install workspace dependencies, then run:

```sh
pnpm run desktop
```

The command builds the Host libraries and Electron application before opening the window. Set `DSH_DESKTOP_NODE` to an ordinary Node executable when the Electron main process cannot inherit a suitable one.

## Current scope

- The main process supervises one independent ACP Runtime and terminates it before quitting.
- Session list and load use the Runtime's durable ACP operations; loading replays presentation updates.
- Session close releases the live handle without deleting durable history.
- The technical Renderer can create and load Sessions, submit a prompt, cancel the active turn, answer permission requests, and display ACP update frames.

This is not a distributable desktop release. It does not yet package an ordinary Node runtime or native modules into a `.app`, provide code signing, notarization, DMG generation, updates, crash recovery, a first-run flow, or the full product interface. Those remain later phases of the attached desktop plan.
