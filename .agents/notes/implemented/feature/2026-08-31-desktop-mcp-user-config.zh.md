# Agent Note: Desktop 用户 MCP 服务器配置

Status: implemented

[English](2026-08-31-desktop-mcp-user-config.md) | 中文

## 问题

MCP 客户端每个插件实例接收一台由部署定义的服务器，但 Desktop 用户没有添加服务器的产品入口。要求 Agent 配置 MCP 时，它只能给出说明或修改部署 YAML；另做一条设置路径又可能与 Runtime 的服务器清单分叉。

## 决策

`@deepseek-ai/dsh-mcp-user-config` 持有一份带版本的 JSON 服务器清单。路径来自 `DSH_MCP_CONFIG_PATH` 或 harness home；内容按精简的 stdio／Streamable HTTP 联合类型校验，并为每项挂载已有的 `mcp-client`。它不重复实现 MCP 传输、发现、重连或工具投影。

Desktop Main 与 Runtime 使用同一份文档。Main 只暴露类型化的列表、新增或更新、删除 IPC；列表会隐藏值，但保留凭据键名。界面写入会原子替换仅所有者可读写的文件，并重启受监督的 Runtime。Runtime 的 `mcp_config` 工具通过同一组加锁函数写入，并立即协调子 fiber，因此用户可以要求 Agent 配置服务器，并在当前进程的后续工作或后续 Session 中使用其工具。

Agent 发起的新增、更新和删除会请求一次已有批准，因为该改动可能启动本地进程或连接外部端点。设置页中的直接操作已经是明确的用户意图，不再增加第二次确认。

## 存储与生命周期

文档格式从版本 `1` 开始；不受支持的版本和错误条目会明确失败。写入使用仓库已有的跨进程文件锁与原子替换，文件模式为 `0600`。服务器名称继续作为稳定的 `mcp__<server>__<tool>` 命名空间。文件不存在表示没有用户服务器。外部手工编辑会在下次 Runtime 启动时生效；两个受支持的写入入口会立即应用各自的改动。

## 考虑过的替代方案

**让 Desktop 生成 `cordis.yml` 配置行。** 未采用，因为这会把用户数据混入部署组合，并要求 Electron 进程接管 Loader／HMR 生命周期。

**为 ACP 添加 MCP 方法。** 未采用，因为 MCP 配置是 DSH 产品扩展，而不是 ACP Session 操作；当前 Desktop 桥接已经持有其他本机设置，无需扩宽自动化协议。

**在 Desktop 中实现第二套 MCP 连接管理器。** 未采用，因为 `mcp-client` 已经负责复杂的协议与生命周期行为；新增层只需把用户清单映射为 client fiber。

## 结果

Desktop 现在有一个 MCP 设置分区，Agent 也有一个基于同一持久清单、需批准的 `mcp_config` 工具。文件可以包含环境变量值和 HTTP Header 值，权限仅限所有者但不加密；需要独立凭据存储的部署继续通过凭据引用直接组合 `mcp-client`。MCP Resources 和 Prompts 仍不在范围内，因为现有客户端只桥接 Tools。
