# Agent Note: Desktop primary model settings

Status: implemented

English | [中文](2026-08-29-desktop-primary-model-settings.zh.md)

## Problem

The Desktop product needs an OpenAI-compatible model configuration that controls the same ACP Runtime used by conversations. Giving the Renderer a plaintext credential or maintaining a second model client in the UI would expose secrets and bypass the session, tool, approval, and persistence behavior owned by the Runtime.

## Decision

The Settings dialog owns a Desktop-only “Model API” section for protocol, base URL, model id, and API key. Electron's main process validates the non-secret fields, encrypts the key with `safeStorage`, and writes only encrypted credential data to the user-data directory with owner-only file permissions. The preload API returns redacted state and never exposes the stored key to the Renderer.

Saving first sends one bounded text request with a function-tool declaration through the selected OpenAI Chat Completions or Responses protocol. An incompatible protocol, credential, model id, or tool request fails before the existing settings and Runtime are changed. A second bounded request detects optional image input; its failure records a text-only model instead of rejecting a usable endpoint. The optional `GET /models` metadata supplies context and output capacities when the gateway publishes its common extensions.

The managed ACP Runtime restarts only after verification succeeds. `examples/acp-agent/cordis.yml` selects the `llm-pi-ai` provider only when the Desktop model environment is present; its `baseURLEnv` reference resolves the endpoint through the immutable launch snapshot instead of evaluating `process.env` in configuration. The route uses the installed OpenAI catalog so a known model id inherits its exact token, modality, and effort facts while the user-selected protocol and verified endpoint values take precedence. An unknown model defaults to text-only, a 32K context window, an 8K output capability, and no reasoning effort. Conservative compatibility switches omit developer roles, strict tool declarations, store, and streaming-usage extensions that generic gateways commonly reject. The ordinary DeepSeek provider remains the default for CLI, snapshots, and other ACP launches.

## Alternatives considered

**Call the model from the Renderer.** This simplifies the form submission but gives browser code the credential and creates a parallel conversation implementation without Runtime approvals, tools, or durable sessions.

**Store the API key in a JSON settings file.** This is portable but leaves a reusable credential in plaintext. Electron `safeStorage` uses the operating system's protected storage and keeps the configuration file non-sensitive.

**Replace the shared ACP configuration unconditionally.** This would change CLI, replay, and snapshot behavior. A Desktop-only environment switch confines the provider choice to the packaged application's managed Runtime.

**Probe every reasoning effort and context size.** Repeated paid requests still cannot prove a context maximum reliably and can trigger rate limits while saving. The installed catalog provides exact known-model effort data; unknown models omit the effort parameter, and endpoint metadata is adopted only when explicitly published.

## Consequences

- A saved provider is used for new prompts and restored ACP sessions after the Runtime reconnects.
- A failing baseline verification leaves the previous encrypted settings and running Runtime unchanged.
- Optional image input is enabled only after a real request succeeds; Computer Use can remain enabled for text-only models, but screenshot inspection is unavailable to them.
- Existing version-1 and version-2 settings migrate as unverified text-only records and are verified on their next save.
- Renderer code can detect whether a key exists but cannot read it.
- Changing model settings briefly restarts the local Runtime; the supervisor reconnects the product client afterward.
- Capacity discovery remains advisory because the standard OpenAI model-listing response does not define modality, effort, or context fields.
