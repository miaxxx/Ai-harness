# agent 副作用治理审计

[English](side-effect-audit.md) | 中文

治理边界是 **agent 发起的外部副作用**，而不是 Harness 进程执行的每一次写入。会话持久化、遥测、缓存、日志和内部索引仍属于运行时基础设施。

## 必经路径

```text
Agent action
  -> Tool call
  -> validation
  -> hooks
  -> permission / approval
  -> guards
  -> sandbox policy
  -> capability provider execution
  -> result normalization / audit
  -> durable tool result
```

现有工具执行流水线是执行代理。不会引入第二个代理或策略引擎。

## 副作用类别

| 类别 | 面向模型的入口 | 执行所有者 | 静态规则 |
|---|---|---|---|
| 文件系统写入、删除或编辑 | `@deepseek-ai/dsh-tool-*` 文件系统工具 | 文件系统能力或提供方系列 | 工具包不能直接导入 Node `fs` |
| Shell 或子进程 | bash、pwsh、进程或终端工具包 | shell 或终端能力提供方 | 工具包不能直接导入 `child_process` |
| Git 修改 | 工具或能力组合 | 底层受治理的进程或文件系统能力 | 面向模型的工具包中不得存在其他 spawn 或写入路径 |
| 代码运行时 | 工作流或代码执行能力 | 运行时或提供方实现 | 使用相同的工具流水线准入和取消约定 |
| MCP 修改 | 面向 MCP 的工具或能力 | MCP 客户端或提供方边界 | 修改操作仍是工具调用；UI 或客户端不得绕过 |
| 网络写入 | web 或 MCP 能力 | 具备网络访问能力的提供方 | 权限属于策略；不得把文件系统沙箱描述为网络隔离 |

## 自动强制检查

`scripts/verify-side-effect-boundaries.ts` 扫描所有名称以 `@deepseek-ai/dsh-tool-` 开头的工作区包。这些面向模型的包不得直接导入：

- `node:child_process` / `child_process`
- `node:fs`、`node:fs/promises` 或其不带前缀的形式
- 具体的 `@deepseek-ai/dsh-*-sandbox` 实现

这是一个刻意保持精简的架构检查器。提供方实现、运行时基础设施、持久化和沙箱包不在扫描范围内，因为这些层合理地拥有操作系统原语。

## 权限与沙箱

权限回答**该操作是否应当运行？**沙箱回答**进程运行后能够实际访问什么？**权限允许不能视为已受到隔离的证明，沙箱拒绝也不能被简化为普通的工具领域错误。

## 网络边界

当前沙箱词汇主要描述文件系统副作用的限制，并不声称网络或进程可见性已被完全隔离。产品或 UI 文案和错误模型需要区分时，应使用 `filesystem-confined` 等表述。网络隔离、命名空间代理和企业策略引擎不属于本阶段。
