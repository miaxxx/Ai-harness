# Agent Note: Code 与 Work 模式共用内置任务 Skills

Status: implemented

[English](2026-08-29-code-work-modes-and-shared-skills.md) | 中文

## Problem

现有交付 preset 主要围绕编码组装，通用研究、文档和表格请求没有产品自带的工作指导。直接复制 WorkBuddy Skills 还会带入此运行时并不具备的私有工具与连接器假设。另设一层意图路由又会重复 Skill 目录已有的基于描述选择机制，并增加一个需要维护的服务。

## Decision

产品将 Code 与 Work 作为两个主要任务 preset。Code 保留 Code Mode 工具呈现与完整开发工具组装。Work 使用原生工具呈现，并采用由网页搜索、文件系统、Shell、后台任务、压缩、目标、提问、待办和 Skill 加载器组成的精简组装。新安装默认使用 Code；已有用户设置仍覆盖组装默认值。

两个 preset 挂载同一个受信任的内置目录 `apps/cli/config/skills/`。其中包含四个轻依赖 Skill：`code-development`、`web-research`、`document-work` 与 `spreadsheet-work`。它们的描述根据用户任务触发，因此不需要模式路由器，也不要求每轮加载全部 Skill。

Desktop 使用 ACP Runtime，而不是 Web preset 宿主。其监督进程设置 `DSH_DESKTOP_CODE_WORK_ENABLED` 与打包后的内置 Skill 路径，ACP 组装据此挂载同一份 Skill 目录、加载工具和基于 DeepSeek 的网页搜索。打包步骤把共享目录复制进独立 Runtime。通用 ACP 与快照运行不会设置产品标记，因此其人设和工具目录保持不变。

同一个 Desktop 产品标记还会挂载持久化目标领域、同 Session 连续执行驱动器和面向模型的目标工具。普通请求不创建目标。包含至少三个可独立验证工作项的复杂请求会使用一个目标和一份包含三至七项的 `todo_write` 清单；父 agent 持续工作，直到验证完整目标、报告具体阻塞条件或用户取消。提示策略把委派限制为同时最多两个独立子任务，现有 subagent 深度限制则阻止递归委派。ACP 计划更新进入 Desktop 现有的 Todo 面板，不引入第二套任务存储。

这些 Skills 使用当前 preset 已提供的能力。文档和表格指导在专用工具存在时优先使用，否则回退到可移植的 Markdown、HTML、CSV 或 TSV，而不依赖办公 SDK。代码指导在部署已配置语言服务器时使用 LSP，否则回退到搜索和源码检查；交付应用不会仅为了显示 LSP 工具名称而安装语言服务器。

## Alternatives considered

**逐字复制 WorkBuddy 的 Skills 与工具词汇。** 那些说明引用了本运行时不具备的私有工具、连接器和制品服务，会展示实际无法完成的工作流，因此这里只保留可移植的工作指导。

**在用户请求与 Skill 注册表之间增加意图分类插件。** Skill 描述已经提供按请求选择的发现机制。第二个分类器不会增加能力，只会增加路由状态与失败方式。

**让每个复杂 Desktop 任务都使用计划模式或动态工作流。** 计划模式会在执行前停下来等待审阅，而产品需求是在同一个用户轮次内完成计划和执行。动态工作流会增加脚本编排层，但现有的同 Session 目标、Todo 和 subagent 工具已经能够覆盖这些任务。

**随 preset 安装语言服务器与办公库。** 这会把轻量组装变更变成平台相关的依赖管理。LSP 和更丰富的办公格式继续由能力决定：宿主提供时使用，否则明确降级。

## Consequences

Code 与 Work 共用一份维护的工作流目录，同时保留适合各自任务的工具呈现。Work preset 比 Standard 更小，因为它不挂载与核心用途无关的委派、工作流、Ralph 和计划模式服务。系统 Skills 只需在一个位置更新，并同时随 CLI 包和 Desktop Runtime 交付。即使 Desktop 主聊天模型使用其他 OpenAI 兼容提供方，网页搜索仍需要 DeepSeek 搜索凭据。完整 DOCX、XLSX、PDF 与 LSP 行为仍依赖已安装的提供方；Skills 会说明这个限制，而不会展示不可用的能力。

Desktop 复杂任务会消耗额外的模型 Round，并且仍依赖模型准确报告目标和 Todo 状态。产品获得持久连续执行和可见进度，不需要独立调度器、计划数据库或团队协调器。用户仍可取消任务，目标驱动器也不会自动重试提供方或持久化失败。
