# Agent Note: Desktop primary model settings

Status: implemented

English | [中文](2026-08-29-desktop-primary-model-settings.zh.md)

## Problem

The Desktop product needs an OpenAI-compatible model configuration that controls the same ACP Runtime used by conversations. Giving the Renderer a plaintext credential or maintaining a second model client in the UI would expose secrets and bypass the session, tool, approval, and persistence behavior owned by the Runtime.

## Decision

The Desktop Models section owns named profiles, a default profile, optional dedicated subagent endpoints, context/output overrides and declared reasoning choices. Electron Main validates endpoints, encrypts keys with `safeStorage`, and atomically writes owner-only `model-profiles.json`. The legacy `primary-model.json` is imported only when the profile list is absent; missing legacy capacities retain the effective 32K context and 8K output defaults as explicit overrides. Application data and sibling product profiles are not moved. The preload returns redacted state.

Saving verifies bounded function-tool text requests for each changed endpoint, then optional image input. Explicit rechecking refreshes both main and child capabilities. A blank key is reusable only at the same normalized URL and protocol, including edit, inspect and explicit reuse paths. Manual capacities take precedence over endpoint metadata and exact official model/protocol/URL catalog matches. Unknown context capacity requires an explicit value. Generic gateways retain server reasoning defaults unless an override is selected from declared capabilities.

[Profile management](../../../../apps/desktop/src/models/main/profiles.ts) owns serialized mutations and bounded model discovery. The renderer provides profile selection before Send and directory discovery in the profile editor. Directory membership does not prove inference access; saving a different model still verifies it. Dedicated child settings route ordinary subagent, fork and workflow requests without changing tool or enterprise authorization.

[The Runtime pool](../../../../apps/desktop/src/runtime/main/pool.ts) retains immutable model revisions for active requests and routes cancellation to their actual subprocess. Preparation pins a revision until prompt or close; an empty session crossing revisions receives a new identity and retains draft attachments rather than loading a nonexistent log. Durable sessions load through the enterprise-aware supervisor and preserve display references. Idle obsolete revisions terminate. Identity and tool changes revoke every revision before new admission; an old startup or completion cannot publish into the new authority. Each supervisor owns credential expiry and renewal; already-sent failed operations are never retried automatically.

Local per-request diagnostics record bounded evidence through opt-in ACP metadata named `harnessDiagnostics`. Credential fields, lease ids, cookies and common credential text assignments are redacted before transport and again before disk writes. Opening a message log checks current enterprise session access. The logs are temporary diagnostic evidence, not the durable conversation or Kernel audit record. Specialist scan/change/audit tools use existing delegation and do not replace the parent's completion policy; Bash availability does not enforce read-only execution.

## Alternatives considered

**Call the model from the Renderer.** This simplifies the form submission but gives browser code the credential and creates a parallel conversation implementation without Runtime approvals, tools, or durable sessions.

**Store the API key in a JSON settings file.** This is portable but leaves a reusable credential in plaintext. Electron `safeStorage` uses the operating system's protected storage and keeps the configuration file non-sensitive.

**Replace the shared ACP configuration unconditionally.** This would change CLI, replay, and snapshot behavior. A Desktop-only environment switch confines the provider choice to the packaged application's managed Runtime.

**Probe every reasoning effort and context size.** Repeated paid requests still cannot prove a context maximum reliably and can trigger rate limits while saving. The installed catalog provides exact known-model effort data; unknown models omit the effort parameter, and endpoint metadata is adopted only when explicitly published.

Enterprise ownership claims serialize the complete disk transaction and publish the authoritative in-memory map only after the atomic rename. Failed writes grant no session access. A signed-out client cannot load or open logs for an enterprise-owned session; an invalid ownership file fails closed instead of exposing its sessions as local history.

## Consequences

- The default profile controls subsequent prepared requests; already admitted requests keep their captured model.
- A failing baseline verification leaves the previous encrypted settings and running Runtime unchanged.
- Optional image input is enabled only after a real request succeeds; Computer Use can remain enabled for text-only models, but screenshot inspection is unavailable to them.
- Existing version-1 and version-2 settings migrate as unverified text-only records and are verified on their next save.
- Renderer code can detect whether a key exists but cannot read it.
- Model revisions can coexist during active prompts; identity changes retire them all. Failed endpoint verification leaves the stored profile unchanged, while subprocess startup failures remain visible and require choosing or correcting a profile.
- Capacity discovery remains advisory because the standard OpenAI model-listing response does not define modality, effort, or context fields.
