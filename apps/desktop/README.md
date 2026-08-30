# DeepSeek Harness Desktop technical preview

English | [中文](README.zh.md)

This application is the macOS Electron technical preview. Its main process starts an independent standalone ACP Runtime through stdio and exposes only typed Session operations to the Renderer without opening a local TCP port.

## Process ownership

The Electron main process owns the window, the `dsh-app://` resource protocol, IPC admission, and ACP Runtime supervision. Its Renderer is sandboxed with context isolation and no Node integration. The preload exposes fixed workspace, Session, Skill import, attachment staging, artifact export, model settings, and Runtime operations; it does not expose generic IPC, filesystem, shell, or process primitives.

In source mode, the main process uses `@deepseek-ai/dsh-acp-client` to launch the built ACP example Runtime. `DSH_DESKTOP_ACP_COMMAND` and `DSH_DESKTOP_ACP_ARGS_JSON` replace that command when a different Runtime is required. In a packaged application it instead resolves the bundled Node executable, ACP entry, and configuration below `process.resourcesPath`. It maps ACP Session updates into display frames and presents ACP permission choices; the Runtime still owns permission policy and sandbox enforcement.

Desktop runs Code and Work as one automatic task surface: the Runtime infers the request type and loads only the relevant bundled development, web-research, document, or spreadsheet Skill. Shell and filesystem capabilities are shared. Web search uses the DeepSeek search provider and therefore still needs `DEEPSEEK_API_KEY` even when the primary chat model is configured through another OpenAI-compatible endpoint. LSP and binary office formats are used only when a deployment supplies the corresponding provider or tool.

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
- The technical Renderer can create and load Sessions, submit a prompt, cancel the active turn, answer permission requests, and display streamed text, expanded live reasoning, and tool ACP updates. A configured OpenAI-compatible primary model runs with high reasoning enabled.
- Routine prompts run directly. A substantial Desktop task creates one persisted same-session goal, publishes a three-to-seven-item task list, and continues across Goal Rounds until the Runtime records completion or a concrete blocker. The task strip follows ACP plan updates and clears when the next human turn begins.
- The composer add menu exposes attachment upload and a hover-opened Skills catalog. A selected Skill remains a neutral capsule before and after submission; ordinary ACP resource links render as file capsules without exposing their local URI. The picker stages PNG/JPEG/WebP/GIF images and ordinary text/code/Markdown/HTML/JSON/CSV files. Imported user Skills live below `~/.dsh/skills` and are removable from Settings; project and bundled Skills are read-only there.
- Each turn copies created or changed ordinary files into `<workspace>/.dsh/artifacts/<session>/turn-NNNN/`, writes a Session manifest, and displays the resulting files after the final response. A user can open a file, save one copy elsewhere, or export all Session artifacts as ZIP. Binary office-format generation remains outside this scope.

The generated `.app` contains Node, the ACP Runtime, its configuration, JavaScript dependencies, and macOS native helpers. It is deliberately unsigned: macOS may require an explicit user override, and the application is not suitable for public distribution. Code signing, notarization, DMG generation, universal binaries, automatic updates, crash recovery, a first-run flow, and the full product interface remain later work.
