# Agent Note: Desktop primary model settings

Status: implemented

English | [中文](2026-08-29-desktop-primary-model-settings.zh.md)

## Problem

The Desktop product needs an OpenAI-compatible model configuration that controls the same ACP Runtime used by conversations. Giving the Renderer a plaintext credential or maintaining a second model client in the UI would expose secrets and bypass the session, tool, approval, and persistence behavior owned by the Runtime.

## Decision

The Settings dialog owns a Desktop-only “Model API” section for protocol, base URL, model id, and API key. Electron's main process validates the non-secret fields, encrypts the key with `safeStorage`, and writes only encrypted credential data to the user-data directory with owner-only file permissions. The preload API returns redacted state and never exposes the stored key to the Renderer.

Saving restarts the managed ACP Runtime with the selected OpenAI Chat Completions or Responses protocol. `examples/acp-agent/cordis.yml` selects the `llm-pi-ai` provider only when the Desktop model environment is present; its `baseURLEnv` reference resolves the endpoint through the immutable launch snapshot instead of evaluating `process.env` in configuration. The ordinary DeepSeek provider remains the default for CLI, snapshots, and other ACP launches. Conversations therefore retain the existing ACP session and tool path while the selected Desktop provider becomes the primary model.

## Alternatives considered

**Call the model from the Renderer.** This simplifies the form submission but gives browser code the credential and creates a parallel conversation implementation without Runtime approvals, tools, or durable sessions.

**Store the API key in a JSON settings file.** This is portable but leaves a reusable credential in plaintext. Electron `safeStorage` uses the operating system's protected storage and keeps the configuration file non-sensitive.

**Replace the shared ACP configuration unconditionally.** This would change CLI, replay, and snapshot behavior. A Desktop-only environment switch confines the provider choice to the packaged application's managed Runtime.

## Consequences

- A saved provider is used for new prompts and restored ACP sessions after the Runtime reconnects.
- Renderer code can detect whether a key exists but cannot read it.
- Changing model settings briefly restarts the local Runtime; the supervisor reconnects the product client afterward.
- Provider-specific controls beyond protocol, base URL, model id, and API key remain outside this settings section.
