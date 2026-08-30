# Agent Note: Desktop Skills、附件与普通产物

Status: implemented

[English](2026-08-30-desktop-skills-attachments-and-artifacts.md) | 中文

## 问题

Desktop 产品已经能发现 Skills 并交换 ACP 文本，但用户无法导入或选择 Skill、附加本地文件，也无法取回任务创建的文件。若用通用文件系统 IPC 补齐这些能力，会给沙箱 Renderer 不必要的权限，并在 ACP 之外形成第二套文件协议。

## 决策

Desktop 主进程只暴露 Skill 导入／删除、附件暂存和产物导出的窄接口。用户 Skill 经校验后复制到 `~/.dsh/skills`；项目与内置 Skill 保持只读。输入框启动菜单提供附件上传，并以悬停子菜单呈现有效 Skills 目录。两层菜单都有不透明的浮层底色和轻微边缘阴影，命中区域相互重叠，因此鼠标进入子菜单时不会将其关闭。选中的 Skill 是 input-trigger 引用，其模型形式保持 `/skill-name`；输入框和已发送消息把该引用呈现为同一种中性胶囊，图标与名称之间保留间距。

选中的附件先复制到 Session 产物区，再把不透明 id 交给提示调用。图片转换成 ACP image block，支持的普通文件转换成 ACP resource link。Desktop 消息适配器把持久化的方括号资源引用文本投影为文件胶囊，并在可见对话中省略本地 URI。Renderer 不会获得文件字节或任意读取权限。

每次提示前后，主进程会比较工作区中的受支持普通文件。新建或修改的文件复制到 `<workspace>/.dsh/artifacts/<session>/turn-NNNN/`，并记录在 `manifest.json`。Desktop 适配器把这些副本投影为成功编辑位置，因此现有 deliverables 累加器会在最终回复后展示它们。Desktop 专用控件提供原生“另存为”和 ZIP 导出。

## 考虑过的替代方案

**暴露通用文件系统 IPC。** 这会缩短导入、附件与导出代码，但浏览器代码将可以任意读写用户文件。固定操作把路径解析、校验和原生用户确认留在主进程。

**在 Desktop 中另建 Skills 与产物子系统。** 这会隔离预览应用，却会复制 Skill 调用和产物文件规则。复用 Runtime 注册表、ACP 内容块、input-trigger 管线和 deliverables 投影，可以让产品入口保持同一种行为。

## 验证

针对性测试覆盖 Skill 来源优先级与删除、普通附件暂存与 ACP 投影、变更文件捕获、清单存储，以及 ZIP 排除提示输入。Desktop 构建会一起编译主进程、preload、共享产品客户端和生产 Renderer bundle。

## 结果

- 新 UI 共用 Skills 注册表、输入菜单、ACP 提示链路和 deliverables 投影，不复制这些系统。
- Renderer 权限仍是一组固定且由用户操作触发的能力。
- 附件与捕获产物限于图片以及普通文本、代码、Markdown、HTML、JSON、CSV 系列格式，并限制文件大小和扫描数量。
- DOCX、XLSX、PDF 与 PPTX 生成仍属于独立能力。
