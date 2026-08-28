# DeepSeek Harness Desktop 技术预览

[English](README.md) | 中文

本应用是 macOS Electron 第零阶段技术验证。它把现有 DeepSeek Harness agent（智能体）组合保留在独立 Node 子进程中，从该组合移除 Web 服务器和浏览器客户端，并通过 Electron 承载既有类型化 API，不开放本地 TCP 端口。

## 进程职责

Electron 主进程负责窗口、`dsh-app://` 资源协议、IPC 准入和 Agent Host 监督。Renderer 运行在沙箱内，启用上下文隔离且不集成 Node。preload 只暴露请求开始／恢复／取消、帧订阅和 Host 重启；它不暴露通用 IPC、文件系统、shell 或进程原语。

Agent Host 从现有 Web profile 加 `host.patch.yml` 启动。该覆盖层保留 Host 插件和 agent preset，禁用 Web 服务器及全部浏览器客户端插件，安装原生目录选择器，并添加 stdio Fetch 载体。主进程只转换传输帧；API 信封仍由 `@deepseek-ai/dsh-host-apiproxy` 拥有并校验。

## 运行预览

使用 Node 22.19、24 或更高版本，安装 workspace 依赖，然后运行：

```sh
pnpm run desktop
```

该命令会先构建 Host 库和 Electron 应用，再打开窗口。当 Electron 主进程无法继承合适的 Node 时，将 `DSH_DESKTOP_NODE` 设为普通 Node 可执行文件。

## 当前范围

- 主进程监督一个独立 Agent Host，并在退出前终止它。
- `events.mux` 与 `events.host` 仍是同一条带版本 stdio 连接上的两个独立长连接流。
- 请求取消仍按请求生效，不会关闭任一事件流。
- 技术验证 Renderer 可以描述 Host、创建会话、提交提示词、取消活动轮次并显示原始 mux 帧。

这还不是可分发的桌面版本。它尚未把普通 Node 运行时或原生模块打包进 `.app`，也未提供代码签名、公证、DMG 生成、更新、崩溃恢复、首次运行流程或完整产品界面。这些仍属于所附桌面计划的后续阶段。
