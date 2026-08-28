# Agent Note: Electron desktop embedded ACP Runtime distribution

Status: implemented

English | [中文](2026-08-29-electron-desktop-embedded-acp-runtime.zh.md)

## Problem

The Electron technical preview starts an ordinary Node ACP Runtime, but repository-relative entry and configuration paths make the application unusable after relocation. Copying pnpm workspace links into an application also leaves references to the build checkout, while native helpers and Node architecture must match the destination Mac. A packaged application must start without an installed Node, package manager, repository checkout, or network dependency installation.

## Decision

`python/sdk-runtime` is the shared dependency-only deploy root for the standalone JSON-RPC and desktop ACP compositions. It includes the ACP entry and every plugin named by the desktop configuration. `scripts/build-desktop-runtime.ts` deploys that verified graph with injected workspace packages, replaces remaining links with files, and copies `examples/acp-agent/cordis.yml` into the staged Runtime.

The staging script downloads the pinned official Node 24.18.1 archive for the host macOS architecture and rejects a mismatched SHA-256 digest. electron-builder copies the staged directory outside asar at `Contents/Resources/runtime` and produces a host-architecture directory target with signing disabled. The packaged main process resolves Node, the ACP entry, and configuration from `process.resourcesPath`; source mode retains repository paths and command overrides.

The Electron main bundle includes the ACP client, protocol SDK, and schema validator. Only Electron remains external, so application startup does not depend on pnpm's workspace layout. `scripts/verify-desktop-dist.ts` copies the completed application outside the repository, removes external Node and package-manager paths from its environment, starts the real packaged main process, and requires the embedded Runtime to initialize and answer a Session query.

## Alternatives considered

**Run the Runtime with Electron's embedded Node.** `ELECTRON_RUN_AS_NODE` removes the separate Node download, but couples Runtime ABI and process behavior to Electron. The ordinary Node sidecar preserves the standalone Runtime execution model.

**Package workspace `node_modules` directly.** This is smaller build tooling, but pnpm links retain checkout paths and electron-builder does not infer every dynamically loaded Cordis plugin. An explicit deploy root owns the Runtime closure.

**Compile the ACP Runtime into one executable.** The Python SDK distribution proves this route, but it needs virtual-filesystem asset declarations and native sidecars. The desktop application already supplies a resource directory, so Node plus a materialized dependency tree keeps dynamic plugin loading ordinary.

## Consequences

- The host-architecture `.app` starts after relocation without external Node, pnpm, repository files, or dependency downloads.
- Node upgrades require updating the pinned version and both architecture digests.
- The unsigned directory target is suitable for development and same-architecture offline acceptance, not public distribution.
- Signing, notarization, DMG output, universal binaries, automatic updates, and validation on a separate physical Mac remain outside this decision.
