# Orbis AI Desktop 技术预览

[English](README.md) | 中文

本应用是 macOS Electron 技术预览。窗口界面、侧边栏、空白 Session（会话）主视觉、权限对话框和 Desktop 专属模型 persona 统一使用 Orbis AI 产品身份。主进程通过 stdio 启动独立的 ACP（Agent Client Protocol）运行时，并且只向 Renderer 提供类型化的 Session 操作，不开放本地 TCP 端口。

## 进程职责

Electron 主进程负责窗口、`dsh-app://` 资源协议、IPC 准入和 ACP 运行时监督。Renderer 运行在沙箱内，启用上下文隔离且不集成 Node。preload 只暴露固定的工作区、Session、Skill 导入、附件暂存、产物导出、模型设置、MCP 设置和运行时操作；它不暴露通用 IPC、文件系统、shell 或进程原语。

在源码模式下，主进程使用 `@deepseek-ai/dsh-acp-client` 启动已构建的 ACP 示例运行时。需要其他运行时时，可用 `DSH_DESKTOP_ACP_COMMAND` 和 `DSH_DESKTOP_ACP_ARGS_JSON` 替换该命令。在打包应用中，主进程改为通过 `process.resourcesPath` 定位内置 Node 可执行文件、ACP 入口和配置。主进程把 ACP Session 更新映射为展示帧，并呈现 ACP 权限选项；运行时仍拥有权限策略与沙箱强制执行。

Desktop 将 Code 与 Work 作为一个自动任务表层运行：Runtime 判断请求类型，并加载相关的开发、网页研究、文档或表格内置 Skill。会产生产物的任务还会加载内置 delivery-verification Skill；其最终验收按产物类型分流，并重复检查、修复和重新检查，直到当前产物通过或仍有具体阻塞条件。Shell 与文件系统能力共用。网页搜索使用 DeepSeek 搜索提供方，因此即使主聊天模型配置为其他 OpenAI 兼容端点，仍需要 `DEEPSEEK_API_KEY`。只有部署提供了相应提供方或工具时，才使用 LSP 与二进制办公格式。

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

构建会下载与宿主架构匹配的官方 Node 24.18.1 固定版本，校验 SHA-256 摘要，部署无软链接的运行时依赖树，并写入 `apps/desktop/dist-electron/mac-<arch>/Orbis AI.app`。验证会把应用复制到仓库外，并在不含外部 Node 或包管理器路径的环境中启动；内置 ACP 运行时必须完成初始化并响应 Session 查询。该流程验证构建 Mac 上的重定位与离线启动；同架构的另一台实体 Mac 仍是发布验收环境。

## 当前范围

- 主进程监督一个独立 ACP 运行时，并在退出前终止它。
- Session 列表和加载使用 Runtime 的持久 ACP 操作；加载会回放展示更新。
- Session 关闭会释放实时句柄，不删除持久历史。
- 技术验证 Renderer 可以创建和加载 Session、提交提示词、取消活动轮次、回答权限请求，并显示流式文本、默认展开的实时推理以及由 ACP 更新渲染的工具卡片。提示词被拒绝时，错误会继续显示在输入区域，不会表现成消息发出后无人回复。配置的 OpenAI 兼容主模型会启用高强度推理。设置会在用户明确开启前保持 Computer Use 关闭；可用时使用本机 Chromium DevTools 端点，否则使用 macOS 辅助功能，截图和每次输入操作仍会请求批准。截图检查还要求主模型支持图片输入，原生截图则需要 macOS 屏幕录制权限。内置 ACP 图片存储每次接纳一张不超过 201,326,592 源像素且单边不超过 32,768px 的大型画布截图，随后把长边规范化到 2048px，再写入模型可见的持久历史。
- 普通提示直接执行。复杂 Desktop 任务会创建一个持久化的同 Session 目标、发布包含三至七项的任务清单，并在多个 Goal Round 中持续推进，直到 Runtime 记录完成状态或具体阻塞条件。任务条跟随 ACP 计划更新，并在下一条人工消息开始时清空。
- 输入框加号菜单提供附件上传和悬停展开的 Skills 目录。选中的 Skill 在发送前后保持带内边距的中性胶囊，不会自动插入任务提示；普通 ACP resource link 显示为文件胶囊，不暴露本地 URI。文件选择器可暂存 PNG／JPEG／WebP／GIF 图片以及普通文本、代码、Markdown、HTML、JSON、CSV 文件。图片会作为 ACP image block 发送给已配置的支持视觉输入的 OpenAI 兼容模型，而不是本地路径。用户导入的 Skill 位于 `~/.dsh/skills`，可在设置中删除；项目和内置 Skill 在管理页只读。
- 每轮会把新建或修改的普通文件复制到 `<workspace>/.dsh/artifacts/<session>/turn-NNNN/`，写入 Session 清单，并在最终回复后展示产物。用户可以打开文件、单独另存一份或把 Session 的全部产物导出为 ZIP。二进制办公格式生成不在本阶段范围内。
- 设置页可以添加、编辑和删除 stdio 或 Streamable HTTP MCP 服务器。仅所有者可读写的 Desktop 文档由 Runtime 共用；界面直接编辑会重启 Runtime，需批准的 `mcp_config` 工具则让用户可以要求 Agent 配置同一份清单。连接后的工具以 `mcp__<server>__<tool>` 名称继续供后续 Session 使用。

生成的 `.app` 已包含 Node、ACP 运行时、配置、JavaScript 依赖和 macOS 原生辅助程序。它按设计不签名：macOS 可能要求用户明确放行，并且该应用不适合公开分发。代码签名、公证、DMG 生成、通用二进制、自动更新、崩溃恢复、首次运行流程和完整产品界面仍属于后续工作。
