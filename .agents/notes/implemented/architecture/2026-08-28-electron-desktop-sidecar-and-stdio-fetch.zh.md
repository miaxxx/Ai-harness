# Agent Note: Electron 桌面 sidecar 与 stdio Fetch 载体

Status: implemented

[English](2026-08-28-electron-desktop-sidecar-and-stdio-fetch.md) | 中文

## 问题

现有 Web 应用已通过类型化 API 网关暴露 Agent、Session、工具、设置和事件流，但其产品组合以 HTTP 服务器和浏览器客户端为前提。Electron 桌面应用需要复用这些 Host 行为，同时让 Agent 执行、原生模块、文件系统访问和进程职责留在沙箱 Renderer 之外。即使两个进程已有受监督的父子关系，在桌面壳内运行现有 Web 服务器仍会保留环回端口及其来源／信任策略。

桌面技术验证必须先确立进程拆分与传输，之后才能迁移产品界面。它需要两个相互独立的长连接事件流、并发一元调用、按请求取消、明确的 Host 启停，以及不定义第二套业务 API 的窄 preload 接口。

## 决策

`apps/desktop` 是一个包含三级权限的 Electron 应用。主进程负责窗口、`dsh-app://` 资源协议、IPC 准入，以及一个通过普通 Node 独立 spawn 的 Agent Host。启用上下文隔离和沙箱的 preload 只暴露请求开始、响应恢复、请求取消、帧订阅和 Host 重启。Renderer 不集成 Node，并使用现有 `AbstractApiClient` API。

Agent Host 以 Web profile 加 `apps/desktop/host.patch.yml` 启动仓库 CLI。该覆盖层保留 Host 服务和 preset，禁用 HTTP 服务器及浏览器客户端插件，选择原生目录选择器，并挂载 `@deepseek-ai/dsh-host-apiproxy/stdio-plugin`。这是技术预览组合，不是可分发应用包：子进程当前从仓库源码和已安装的 workspace 依赖启动。

`@deepseek-ai/dsh-host-apiproxy` 拥有第 1 版专用换行分隔 JSON stdio Fetch 载体。主进程与 Host 在请求前交换 `hello`／`ready`。请求 id 在一条连接上复用并发元数据、base64 响应体分片、完成、错误与取消。载体只接受 `/api/` 路径，在不解释 API 信封的情况下转发请求体，把每个取消帧映射到该请求的 `AbortController`，并在输入关闭时中止全部活动请求。协议版本不匹配是致命错误，不提供兼容回退。

响应元数据与响应体投递有意拆开。主进程会缓冲响应体帧，直到 Renderer 构造好 `ReadableStream` 并发送恢复信号，避免快速一元响应抢在流消费方之前到达。取消监听器会保留到匹配的响应体结束或报错，因此长连接事件流在响应头到达后被中止时，取消仍能传到 Host。

主进程通过带严格内容安全策略的特权应用协议提供 Renderer 资源，拒绝导航和新窗口，并且只接受来自该协议应用来源的桌面 IPC。Host 启动具有固定握手超时。应用正常退出时会关闭 stdin、发送 `SIGTERM` 并等待进程退出；只有超过限定的关闭间隔后才使用 `SIGKILL`。

## 考虑过的替代方案

**在 Electron 主进程内运行 Agent Host。** 这会少一个进程和一种载体，但 Agent 崩溃、原生模块故障或阻塞工具会与窗口共享生命周期，还会让 Host 使用 Electron 内嵌 Node 的 ABI。独立普通 Node 执行保留了故障隔离和仓库现有的运行时假设。

**在 Renderer 中加载 Agent 代码。** 这可以直接调用 UI，但需要 Node 集成或宽泛的 preload 原语，并会把进程、文件系统和凭据权限放进信任最低的进程。Renderer 因此仍作为 API 消费方。

**保留环回 HTTP 服务器。** 这可以原样复用 Web 载体，但会让两个已有直接受监督通道的进程继续承担端口分配、来源检查和本地服务器生命周期。stdio 载体复用同一 Fetch handler，不引入网络监听器。

**定义 Electron 专用业务协议。** 类型化 IPC 方法可以镜像每项 API 操作，但会重复请求 schema、事件语义、超时规则和未来方法。承载不透明 Fetch 请求使 `ApiProxy` 与 `AbstractApiClient` 继续作为仅有的业务协议 owner。

## 验证

stdio 载体测试覆盖并发独立响应流、匹配请求取消和版本协商快速失败。桌面构建分别对 main、preload 与 Renderer face 执行类型检查，将 preload 构建为 Electron 沙箱使用的 CommonJS，并在打包 main 进程时把 Electron 保持为外部依赖。

运行时冒烟测试通过覆盖层启动真实 Host 组合，完成版本握手，调用 `host.describe`，并发打开 `events.mux` 与 `events.host`，然后分别取消两者。Electron 预览也已对该 Host 启动，并通过沙箱 Renderer 显示 ready 状态和 Host 描述。

## 后果

- 桌面工作可以复用 Host 插件与类型化 API 方法，同时替换 Web 服务器和浏览器传输。
- 传输帧现在是 `dsh-host-apiproxy` 的公开子路径；帧兼容性变化时必须修改其版本。
- Electron 主进程仍是传输与生命周期 owner，而不是第二个 API 网关。
- 当前预览需要仓库源码、workspace 依赖和合适的普通 Node 可执行文件。
- 将 Node 和原生模块打包进 `.app`、签名、公证、DMG 生成、更新、恢复策略、首次运行体验和完整产品界面仍不属于本次已实现范围。
