# DeepSeek Harness Desktop technical preview

English | [中文](README.zh.md)

This application is the macOS Electron technical preview. Its main process starts an independent standalone ACP Runtime through stdio and exposes only typed Session operations to the Renderer without opening a local TCP port.

## Process ownership

The Electron main process owns the window, the `dsh-app://` resource protocol, IPC admission, and ACP Runtime supervision. Its Renderer is sandboxed with context isolation and no Node integration. The preload exposes workspace lookup, Session list/create/load/close, prompt/cancel, frame subscription, and Runtime restart; it does not expose generic IPC, filesystem, shell, or process primitives.

In source mode, the main process uses `@deepseek-ai/dsh-acp-client` to launch the built ACP example Runtime. `DSH_DESKTOP_ACP_COMMAND` and `DSH_DESKTOP_ACP_ARGS_JSON` replace that command when a different Runtime is required. In a packaged application it instead resolves the bundled Node executable, ACP entry, and configuration below `process.resourcesPath`. It maps ACP Session updates into display frames and presents ACP permission choices; the Runtime still owns permission policy and sandbox enforcement.

## Run the preview

Use Node 22.19 or 24 or newer, install workspace dependencies, then run:

```sh
pnpm run desktop
```

The command builds the Host libraries and Electron application before opening the window. Set `DSH_DESKTOP_NODE` to an ordinary Node executable when the Electron main process cannot inherit a suitable one.

## Build the unsigned application

Use a supported Node version on macOS, install workspace dependencies, then run:

```sh
pnpm run dist:desktop
pnpm run verify:desktop-dist
```

The build downloads the pinned official Node 24.18.1 archive for the host architecture, checks its SHA-256 digest, deploys a symlink-free Runtime dependency tree, and writes `apps/desktop/dist-electron/mac-<arch>/DeepSeek Harness.app`. The verification copies that application outside the repository and starts it with no external Node or package-manager path; the embedded ACP Runtime must initialize and answer a Session query. This verifies relocation and offline startup on the build Mac. A separate physical Mac of the same architecture remains the release acceptance environment.

## Current scope

- The main process supervises one independent ACP Runtime and terminates it before quitting.
- Session list and load use the Runtime's durable ACP operations; loading replays presentation updates.
- Session close releases the live handle without deleting durable history.
- The technical Renderer can create and load Sessions, submit a prompt, cancel the active turn, answer permission requests, and display ACP update frames.

The generated `.app` contains Node, the ACP Runtime, its configuration, JavaScript dependencies, and macOS native helpers. It is deliberately unsigned: macOS may require an explicit user override, and the application is not suitable for public distribution. Code signing, notarization, DMG generation, universal binaries, automatic updates, crash recovery, a first-run flow, and the full product interface remain later work.
