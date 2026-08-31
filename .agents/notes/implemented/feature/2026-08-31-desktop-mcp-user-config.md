# Agent Note: Desktop-owned MCP server configuration

Status: implemented

English | [中文](2026-08-31-desktop-mcp-user-config.zh.md)

## Problem

The MCP client accepts one deployment-defined server per plugin instance, but Desktop users had no product surface for adding servers. Asking the Agent to configure MCP could only produce instructions or edit deployment YAML, and a separately implemented settings path would risk diverging from the Runtime's server list.

## Decision

`@deepseek-ai/dsh-mcp-user-config` owns one versioned JSON server list. It resolves from `DSH_MCP_CONFIG_PATH` or the harness home, validates a small stdio/Streamable HTTP union, and mounts the existing `mcp-client` once per entry. It does not duplicate MCP transport, discovery, reconnect, or tool projection.

Desktop Main and the Runtime use the same document. Main exposes only typed list/upsert/remove IPC; list results redact values while retaining credential key names. A UI write atomically replaces the owner-only file and restarts the supervised Runtime. The Runtime's `mcp_config` tool writes through the same locked helpers and reconciles its child fibers immediately, so a user can ask the Agent to configure a server and use its tools later in that process or in a later Session.

Agent-initiated upsert and remove request one existing approval because the change can start a local process or connect to an external endpoint. A direct settings-page action is already explicit user intent and does not add a second confirmation.

## Storage and lifecycle

The document format starts at version `1`; unsupported versions and malformed entries fail loud. Writers use the repository's cross-process file lock and atomic replacement with mode `0600`. Server names remain the stable `mcp__<server>__<tool>` namespace. A missing document means no user servers. External manual edits take effect on the next Runtime start; the two supported writers apply their own changes immediately.

## Alternatives considered

**Teach Desktop to generate `cordis.yml` rows.** Rejected because it would mix user data with deployment composition and require Loader/HMR ownership in the Electron process.

**Add MCP methods to ACP.** Rejected because MCP configuration is a DSH product extension rather than an ACP Session operation, and the current Desktop bridge already owns other host-local settings without widening the automation protocol.

**Build a second MCP connection manager in Desktop.** Rejected because `mcp-client` already owns the hard protocol and lifecycle behavior; the new layer only maps a user list to client fibers.

## Consequences

Desktop now has one MCP settings section and the Agent has one approved `mcp_config` tool over the same durable list. The file can contain environment and HTTP header values and is owner-only but not encrypted; deployments requiring an independent credential store continue to compose `mcp-client` directly with credential references. MCP Resources and Prompts remain outside scope because the existing client bridges Tools only.
