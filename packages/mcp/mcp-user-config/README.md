# @deepseek-ai/dsh-mcp-user-config

English | [中文](README.zh.md)

User-plane MCP composition for the Desktop Runtime. One owner-only JSON document lists stdio and Streamable HTTP servers; the plugin mounts the existing `@deepseek-ai/dsh-mcp-client` once per entry and registers `mcp_config` so the model can manage the same list with user approval.

## Configuration

The document path resolves from plugin `path`, then `DSH_MCP_CONFIG_PATH`, then `~/.dsh/mcp-servers.json`. The file has version `1`:

```json
{
  "version": 1,
  "servers": [
    { "transport": "stdio", "serverName": "files", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/miao"], "env": {}, "cwd": "" },
    { "transport": "streamable-http", "serverName": "search", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." } }
  ]
}
```

Writes use a cross-process lock and atomic replacement with owner-only permissions. Each name must match `[A-Za-z0-9_-]{1,32}` and be unique. HTTP endpoints must use HTTP or HTTPS. Missing files mean an empty server list; malformed or unsupported documents fail startup instead of silently dropping tools.

## Runtime behavior

The plugin reads the document once at activation. Each server becomes one child `mcp-client` fiber, so protocol discovery, reconnect, namespacing, result handling, and teardown stay owned by that package. `mcp_config` supports `list`, `upsert`, and `remove`. A mutation requests one approval, updates the document, and reconciles the affected fibers immediately. Desktop settings use the exported file functions and restart the ACP Runtime after a direct UI edit.

## Model Experience

### MCP server configuration

#### What the model sees

The model sees `mcp_config` with `list`, `upsert`, and `remove` actions. List results contain server names, transports, targets, and credential key names but never credential values. Mutations return the same redacted list after approval and activation.

#### Token effect

The fixed tool schema is sent on every request while the plugin is mounted. Calls and redacted results add data-dependent history until compaction.

#### KV Cache effect

Prefix-stable while the schema remains mounted. Each call and result appends after the reusable prefix.

### Mounted MCP tools

#### What the model sees

Once a server connects and discovery succeeds, its tools appear under `mcp__<serverName>__<rawName>`. The existing `mcp-client` owns their schemas, calls, results, reconnect behavior, and removal.

#### Token effect

Each discovered tool adds its data-dependent schema cost to later requests. Removing a server removes its tool definitions.

#### KV Cache effect

Adding, removing, or changing a server's discovered tool set may invalidate reuse from the first changed definition. Calls and results remain append-only.

## Known Limitations and Deferred Work

- The document stores environment and HTTP header values in an owner-only file; it does not encrypt them. Deployments that require a separate secret store should continue to mount `mcp-client` from deployment configuration and credential references.
- Direct edits outside the Desktop settings page are read at the next Runtime start. The model tool reconciles its own writes immediately.
- Only MCP Tools are mounted because `mcp-client` does not yet consume Resources or Prompts.
