# DeepSeek Harness Desktop 技术预览

[English](README.md) | 中文

本应用是 macOS Electron 技术预览。主进程通过 stdio 启动独立的 ACP（Agent Client Protocol）运行时，并且只向 Renderer 提供类型化的 Session（会话）操作，不开放本地 TCP 端口。

## 进程职责

Electron 主进程负责窗口、`dsh-app://` 资源协议、IPC 准入和 ACP 运行时监督。Renderer 运行在沙箱内，启用上下文隔离且不集成 Node。preload 只暴露工作区读取、Session 列出／创建／加载／关闭、提示词／取消、帧订阅和运行时重启；它不暴露通用 IPC、文件系统、shell 或进程原语。

在源码模式下，主进程使用 `@deepseek-ai/dsh-acp-client` 启动已构建的 ACP 示例运行时。需要其他运行时时，可用 `DSH_DESKTOP_ACP_COMMAND` 和 `DSH_DESKTOP_ACP_ARGS_JSON` 替换该命令。在打包应用中，主进程改为通过 `process.resourcesPath` 定位内置 Node 可执行文件、ACP 入口和配置。主进程把 ACP Session 更新映射为展示帧，并呈现 ACP 权限选项；运行时仍拥有权限策略与沙箱强制执行。

## 运行预览

使用 Node 22.19、24 或更高版本，安装 workspace 依赖，然后运行：

```sh
pnpm run desktop
```

该命令会先构建 Host 库和 Electron 应用，再打开窗口。当 Electron 主进程无法继承合适的 Node 时，将 `DSH_DESKTOP_NODE` 设为普通 Node 可执行文件。

## 构建未签名应用

在 macOS 上使用受支持的 Node 版本，安装 workspace 依赖，然后运行：

```sh
pnpm run dist:desktop
pnpm run verify:desktop-dist
```

构建会下载与宿主架构匹配的官方 Node 24.18.1 固定版本，校验 SHA-256 摘要，部署无软链接的运行时依赖树，并写入 `apps/desktop/dist-electron/mac-<arch>/DeepSeek Harness.app`。验证会把应用复制到仓库外，并在不含外部 Node 或包管理器路径的环境中启动；内置 ACP 运行时必须完成初始化并响应 Session 查询。该流程验证构建 Mac 上的重定位与离线启动；同架构的另一台实体 Mac 仍是发布验收环境。

## 当前范围

- 主进程监督一个独立 ACP 运行时，并在退出前终止它。
- Session 列表和加载使用 Runtime 的持久 ACP 操作；加载会回放展示更新。
- Session 关闭会释放实时句柄，不删除持久历史。
- 技术验证 Renderer 可以创建和加载 Session、提交提示词、取消活动轮次、回答权限请求，并显示 ACP 更新帧。

生成的 `.app` 已包含 Node、ACP 运行时、配置、JavaScript 依赖和 macOS 原生辅助程序。它按设计不签名：macOS 可能要求用户明确放行，并且该应用不适合公开分发。代码签名、公证、DMG 生成、通用二进制、自动更新、崩溃恢复、首次运行流程和完整产品界面仍属于后续工作。
