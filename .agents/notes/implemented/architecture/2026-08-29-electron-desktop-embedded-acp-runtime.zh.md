# Agent Note: Electron 桌面端内置 ACP 运行时分发

Status: implemented

[English](2026-08-29-electron-desktop-embedded-acp-runtime.md) | 中文

## 问题

Electron 技术预览会启动普通 Node ACP 运行时，但依赖仓库的入口与配置路径使应用在重定位后无法使用。把 pnpm workspace 链接复制进应用还会遗留对构建 checkout 的引用，而原生辅助程序与 Node 架构必须匹配目标 Mac。打包应用必须能在未安装 Node、包管理器、仓库 checkout 且不通过网络安装依赖的情况下启动。

## 决策

`python/sdk-runtime` 是独立 JSON-RPC 与桌面 ACP 组合共用的纯依赖部署根目录。它包含 ACP 入口及桌面配置命名的全部插件。`scripts/build-desktop-runtime.ts` 通过注入 workspace 包部署这份已验证的依赖图，把剩余链接替换为文件，并将 `examples/acp-agent/cordis.yml` 复制到暂存运行时。

暂存脚本下载与宿主 macOS 架构匹配的官方 Node 24.18.1 固定版本，并拒绝 SHA-256 摘要不匹配的归档。electron-builder 把暂存目录复制到 asar 外的 `Contents/Resources/runtime`，在禁用签名的情况下生成宿主架构目录目标。打包后的主进程通过 `process.resourcesPath` 定位 Node、ACP 入口和配置；源码模式保留仓库路径与命令覆盖能力。

Electron 主进程 bundle 包含 ACP 客户端、协议 SDK 和 schema 校验器。只有 Electron 保持为外部模块，因此应用启动不依赖 pnpm workspace 布局。`scripts/verify-desktop-dist.ts` 把完成的应用复制到仓库外，从环境中移除外部 Node 与包管理器路径，启动真实的打包主进程，并要求内置运行时完成初始化及响应 Session 查询。

## 考虑过的替代方案

**使用 Electron 内置 Node 运行 Runtime。** `ELECTRON_RUN_AS_NODE` 可以省去单独下载 Node，但会把运行时 ABI 和进程行为耦合到 Electron。普通 Node sidecar 保留独立运行时的执行模型。

**直接打包 workspace `node_modules`。** 其构建工具更少，但 pnpm 链接会保留 checkout 路径，electron-builder 也无法推断全部动态加载的 Cordis 插件。显式部署根目录负责运行时闭包。

**把 ACP 运行时编译成单个可执行文件。** Python SDK 分发已证明这条路径可行，但它需要虚拟文件系统资源声明和原生 sidecar。桌面应用本来就提供资源目录，因此 Node 加实体化依赖树可保持普通的动态插件加载方式。

## 后果

- 宿主架构 `.app` 在重定位后无需外部 Node、pnpm、仓库文件或依赖下载即可启动。
- Node 升级必须同时更新固定版本和两种架构的摘要。
- 未签名目录目标适合开发和同架构离线验收，不适合公开分发。
- 签名、公证、DMG 输出、通用二进制、自动更新以及另一台实体 Mac 上的验证不属于本决策范围。
