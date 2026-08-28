# DeepSeek Harness Desktop technical preview

English | [中文](README.zh.md)

This application is the phase-zero macOS Electron proof of concept. It keeps the existing DeepSeek Harness Agent composition in an independent Node child process, removes the Web server and browser client from that composition, and carries the existing typed API through Electron without opening a local TCP port.

## Process ownership

The Electron main process owns the window, the `dsh-app://` resource protocol, IPC admission, and Agent Host supervision. Its Renderer is sandboxed with context isolation and no Node integration. The preload exposes only request start/resume/cancel, frame subscription, and Host restart; it does not expose generic IPC, filesystem, shell, or process primitives.

The Agent Host starts from the existing Web profile plus `host.patch.yml`. The overlay retains Host plugins and agent presets, disables the Web server and all browser-client plugins, installs the native directory picker, and adds the stdio Fetch carrier. The main process translates transport frames only; API envelopes remain owned and validated by `@deepseek-ai/dsh-host-apiproxy`.

## Run the preview

Use Node 22.19 or 24 or newer, install workspace dependencies, then run:

```sh
pnpm run desktop
```

The command builds the Host libraries and Electron application before opening the window. Set `DSH_DESKTOP_NODE` to an ordinary Node executable when the Electron main process cannot inherit a suitable one.

## Current scope

- The main process supervises one independent Agent Host and terminates it before quitting.
- `events.mux` and `events.host` remain independent long-lived streams over one versioned stdio connection.
- Request cancellation remains per-request; it does not close either event stream.
- The technical Renderer can describe the Host, create a session, submit a prompt, cancel the active turn, and display raw mux frames.

This is not a distributable desktop release. It does not yet package an ordinary Node runtime or native modules into a `.app`, provide code signing, notarization, DMG generation, updates, crash recovery, a first-run flow, or the full product interface. Those remain later phases of the attached desktop plan.
