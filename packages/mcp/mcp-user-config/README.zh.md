# @deepseek-ai/dsh-mcp-user-config

[English](README.md) | 中文

Desktop Runtime 的用户层 MCP 组合。一个仅所有者可读写的 JSON 文档列出 stdio 与 Streamable HTTP 服务器；插件为每项挂载已有的 `@deepseek-ai/dsh-mcp-client`，并注册 `mcp_config`，让模型在用户批准后管理同一份清单。

## 配置

文档路径依次取插件 `path`、`DSH_MCP_CONFIG_PATH`、`~/.dsh/mcp-servers.json`。文件版本为 `1`：

```json
{
  "version": 1,
  "servers": [
    { "transport": "stdio", "serverName": "files", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/miao"], "env": {}, "cwd": "" },
    { "transport": "streamable-http", "serverName": "search", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." } }
  ]
}
```

写入使用跨进程锁和原子替换，并固定为仅所有者可读写。每个名称必须匹配 `[A-Za-z0-9_-]{1,32}` 且保持唯一。HTTP 端点必须使用 HTTP 或 HTTPS。文件不存在表示清单为空；格式错误或版本不受支持会令启动失败，不会静默丢弃工具。

## 运行时行为

插件在激活时读取一次文档。每台服务器成为一个子 `mcp-client` fiber，因此协议发现、重连、命名空间、结果处理和清理仍由该包负责。`mcp_config` 支持 `list`、`upsert` 和 `remove`。修改会请求一次批准，更新文档并立即协调受影响的 fiber。Desktop 设置页使用同一组文件函数，并在用户直接编辑后重启 ACP Runtime。

## 模型体验

### MCP 服务器配置

#### 模型可见内容

模型可以看到带 `list`、`upsert` 与 `remove` 动作的 `mcp_config`。清单结果包含服务器名称、传输方式、目标和凭据键名，但不包含凭据值。修改获批并激活后返回同样经过脱敏的清单。

#### Token 影响

插件挂载期间，每次请求都会携带固定的工具 schema。调用和脱敏结果会增加随数据变化的历史，直至被压缩。

#### KV Cache 影响

Schema 挂载不变时前缀稳定。每次调用和结果都追加在可复用前缀之后。

### 已挂载的 MCP 工具

#### 模型可见内容

服务器连接并完成发现后，其工具会以 `mcp__<serverName>__<rawName>` 出现。已有 `mcp-client` 负责这些工具的 schema、调用、结果、重连和移除。

#### Token 影响

每个已发现工具都会给后续请求增加随数据变化的 schema 成本。移除服务器也会移除其工具定义。

#### KV Cache 影响

新增、移除服务器或改变已发现工具集合，可能从首个变化的定义开始令复用失效。调用与结果保持仅追加。

## 已知限制与延后事项

- 文档把环境变量值和 HTTP Header 值保存在仅所有者可读写的文件中，但不加密。需要独立密钥存储的部署应继续从部署配置和凭据引用挂载 `mcp-client`。
- 在 Desktop 设置页之外直接编辑文件，要到下次 Runtime 启动时才会读取；模型工具自己的写入会立即协调。
- 只挂载 MCP Tools，因为 `mcp-client` 尚未消费 Resources 或 Prompts。
