# DeepSeek Harness Desktop 技术预览

[English](README.md) | 中文

本应用是 macOS Electron 第零阶段技术验证。主进程通过 stdio 启动独立的 ACP（Agent Client Protocol）运行时，并且只向 Renderer 提供类型化的 Session（会话）操作，不开放本地 TCP 端口。

## 进程职责

Electron 主进程负责窗口、`dsh-app://` 资源协议、IPC 准入和 ACP 运行时监督。Renderer 运行在沙箱内，启用上下文隔离且不集成 Node。preload 只暴露工作区读取、Session 列出／创建／加载／关闭、提示词／取消、帧订阅和运行时重启；它不暴露通用 IPC、文件系统、shell 或进程原语。

主进程使用 `@deepseek-ai/dsh-acp-client` 默认启动已构建的 ACP 示例运行时。需要其他运行时时，可用 `DSH_DESKTOP_ACP_COMMAND` 和 `DSH_DESKTOP_ACP_ARGS_JSON` 替换该命令。主进程把 ACP Session 更新映射为展示帧，并呈现 ACP 权限选项；运行时仍拥有权限策略与沙箱强制执行。

## 运行预览

使用 Node 22.19、24 或更高版本，安装 workspace 依赖，然后运行：

```sh
pnpm run desktop
```

该命令会先构建 Host 库和 Electron 应用，再打开窗口。当 Electron 主进程无法继承合适的 Node 时，将 `DSH_DESKTOP_NODE` 设为普通 Node 可执行文件。

## 当前范围

- 主进程监督一个独立 ACP 运行时，并在退出前终止它。
- Session 列表和加载使用 Runtime 的持久 ACP 操作；加载会回放展示更新。
- Session 关闭会释放实时句柄，不删除持久历史。
- 技术验证 Renderer 可以创建和加载 Session、提交提示词、取消活动轮次、回答权限请求，并显示 ACP 更新帧。

这还不是可分发的桌面版本。它尚未把普通 Node 运行时或原生模块打包进 `.app`，也未提供代码签名、公证、DMG 生成、更新、崩溃恢复、首次运行流程或完整产品界面。这些仍属于所附桌面计划的后续阶段。
