# @deepseek-ai/dsh-acp-client

[English](README.md) | 中文

面向产品侧 Node.js Host 的 ACP stdio transport，供 CLI、IDE 与 Desktop 驱动独立 DeepSeek Harness Runtime。该包只拥有子进程生命周期和 ACP connection，不拥有 Agent、Session、Tools、Persistence、Permission Policy 或 Sandbox；这些能力仍全部属于被启动的 Runtime。

## 所有权

| 关注点 | 所有者 |
|---|---|
| Runtime 可执行文件选择与进程生命周期 | 产品 Host，通过 `AcpRuntimeSpec` 与 `dispose()` |
| ACP framing、initialize、update、permission request | `@deepseek-ai/dsh-acp-client` + `@agentclientprotocol/sdk` |
| Session list/load/resume/new/prompt/close 语义 | Runtime 内的 ACP Server |
| Durable Session identity 与 replay | Runtime Persistence |
| Agent Loop 与模型执行 | Runtime |
| Tool Permission 与 Sandbox enforcement | Runtime |
| CLI/IDE/Desktop 的渲染与人机交互 | 对应产品客户端 |

Consumer 直接获得标准 `ClientSideConnection` 并调用 ACP 方法。该包刻意不再包装第二套 Session facade，也不把 ACP 翻译成另一种产品协议。

## API

`connectAcpRuntime(spec, handlers)` 启动指定 Runtime executable，将 stdin/stdout 保留给 ACP，完成协议 initialize，并返回 `{ client, dispose }`。

`AcpRuntimeSpec` 包含 `command`、`args`、`cwd` 和可选的显式环境变量增量。Runtime command 由 deployment/product host 决定且可替换；Client 不通过 import Runtime package 的方式直接创建 Agent 或 Session。

`AcpClientHandlers.onSessionUpdate` 接收标准 ACP Session update。`onPermissionRequest` 可选；缺省时 permission request 返回 `cancelled`，因此缺少 UI 不会变成隐式授权。`onRuntimeStderr` 可将 Runtime diagnostic 路由到 IDE 或 Desktop 的日志表面；未提供时继承 stderr。ACP frame 始终只占用 stdout。

## 生命周期

Dispose 首先关闭 Runtime stdin。符合当前产品契约的 ACP Runtime 将 EOF 视为 cooperative shutdown signal，在退出前让 live agent quiesce 并 flush durable Session state。若在有限 EOF grace 内没有退出，Client 会在 POSIX 上升级为 `SIGTERM`，最终使用 `SIGKILL`；Windows 在 EOF grace 后直接进入强制终止。`dispose()` 仅在进程已退出后完成，并对单个 connection 保持幂等。

启动失败同样会先回收 child process 再 reject。因此产品可以把成功的 `connectAcpRuntime()` 视为一个已经 initialize 的 live ACP connection，把完成的 `dispose()` 视为进程已 quiesce。

## 安全

该包不是 Sandbox，也不负责做授权决策。它只把 permission request 交给产品端处理；没有 permission handler 时默认拒绝。Runtime 继续独立负责 Permission（是否应该执行）与 Sandbox（是否能够执行）两层判断。

该包不会主动清洗继承的环境变量。产品启动策略负责决定哪些环境变量可以继承，并可通过 `AcpRuntimeSpec.env` 添加显式变量。Runtime stdout 必须保持纯 ACP frame，diagnostic 应写入 stderr。

## Model Experience

无直接影响。该 transport 运行在 Harness 进程之外，不增加任何 model-visible content。Prompt block、tool result 与 durable history 由 ACP 和 Runtime Session Log 定义。

#### KV Cache effect

无。该 transport 不修改模型请求或持久化 Session 内容。

## Known Limitations and Deferred Work

- 当前 standalone-runtime 阶段只支持 stdio transport；socket/daemon discovery 明确不在 P0 范围内。
- 一个 connection 拥有一个 Runtime subprocess；P0 仍不支持多个 Harness process 同时激活同一个 persisted Session。
- Environment scrubbing 属于产品启动策略；该包只将显式传入的增量合并到启动进程环境中。
