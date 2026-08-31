# Agent Note: Desktop Orbis product identity

Status: implemented

English | [中文](2026-08-31-desktop-orbis-product-identity.zh.md)

## Problem

The Desktop application reused the repository's official DeepSeek Harness brand occupants, generic blank-session copy, and fixed Harness system-prompt identity. That presentation conflated the standalone Desktop product with its underlying agent harness and with the DeepSeek model and search providers.

## Decision

Desktop owns an Orbis-specific client plugin that fills the shared sidebar and hero brand slots. The expanded sidebar renders `Orbis`, the compact rail renders an `O` monogram, and the blank-session hero uses the build-time `Orbis AI` headline without the generic whale mark or preview badge. Electron window chrome, permission copy, failure copy, package identity, and the packaged application name use Orbis AI.

The Desktop ACP composition disables the fixed Harness identity and supplies a Desktop-only persona beginning with `You are Orbis AI`. Other ACP compositions retain the fixed Harness identity by default. DeepSeek provider names, model ids, API environment variables, package scopes, and repository paths remain technical identifiers because changing them would misdescribe the configured provider or break resolution rather than change product presentation.

## Alternatives considered

**Rename every DeepSeek identifier in the repository.** Rejected because provider routes, environment variables, package scopes, and model ids describe real integration and compatibility points rather than Desktop branding.

**Replace visible text with CSS overlays.** Rejected because accessibility text, window metadata, permission dialogs, packaged filenames, and model-visible identity would retain conflicting brands.

## Consequences

Desktop has one product identity across visible UI, packaged artifacts, and model behavior while the shared harness and provider integrations remain accurate. The ACP app exposes its existing identity opt-out so a product-owned persona can replace the default explicitly. Brand verification covers the expanded, compact, and hero occupants; the packaged smoke test resolves the Orbis AI application and executable names.
