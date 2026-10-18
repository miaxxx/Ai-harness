# Mona buddy-sdk 迁移交付与回归记录

日期：2026-10-12。目标仓库：Ai-harness，工作分支：`feature/obis-unified-control-plane`。迁移前提交：`e62765e5233c97062274bb3c06a32785411a8d8e`；参考 Mona buddy-sdk 提交：`259fbeec65930b23d4168dc765d1d4491aafedeb`。修改保留在当前工作区，业务代码已暂存，未提交或推送。

## 交付结论

已按评估执行功能迁移，并针对 OBIS 企业身份、委托凭据、审批、会话归属和运行时切换补充回归。在本次覆盖的场景中未发现 OBIS 兼容回归。迁移保留 Orbis 桌面入口、数据目录和企业控制平面；没有整体合并 Mona 分支，也没有替换 ARH 的持续质量策略。

两仓库 master 在评估时同为 `25557bb7385289162f640b1e40f6716ea4ec3d04`，底座一致。当前企业分支已经分化，不能据此认为新增功能可以无条件百分百复制。Mona 远端读取缺少认证，本次使用已存在的本地固定提交。功能名称 buddy-sdk 不意味着 TypeScript/Python SDK 已被重写；参考差异未直接修改这两套 SDK。

## 已迁移功能

| 功能 | 本次实现与兼容措施 |
| --- | --- |
| 多模型配置 | 命名配置、默认配置、模型目录检测、能力检测、手动容量覆盖、推理强度选择；旧单模型配置仅在新配置不存在时导入，保留原有效容量 |
| 模型运行时池 | 每个已开始请求固定模型快照；切换模型不改变旧请求；取消定位实际进程；空草稿与已持久化会话分别处理 |
| 主模型与子代理模型 | 子代理默认参数逐字段合并，显式调用参数优先；清除继承的启用和推理环境标志，避免移除配置后继续使用旧值 |
| 企业运行时隔离 | 每个进程拥有独立委托凭据生命周期；企业身份或工具配置变化立即使旧实例失效；异步启动完成后再次核验企业范围 |
| 诊断与消息日志入口 | 可选 ACP 诊断元数据、用户消息日志入口、大小和保留期限限制、密钥与委托凭据脱敏、退出时排空；日志读取前后均校验会话归属 |
| 流式消息 | 保留现有 ARH 会话恢复流程，跳过已经完成消息的重复回放块，区分用户消息与中途引导消息 |
| 目标续跑 | 首次输出长度截断可继续；连续第二次截断停止自动续跑，目标仍保持活动状态，避免无限续跑 |
| 沙箱与工具路径 | macOS/Linux 支持显式额外写入目录，用于工具缓存；Windows 未配置该能力，保留明确拒绝；补齐桌面工具路径与缓存环境 |
| 界面与技能 | 迁移浅深主题和组件样式；补充文档工作、代码开发技能以及桌面专用扫描、修改、审计工具组合 |

模型、运行时、诊断与平台逻辑分别放入 `apps/desktop/src/models/`、`runtime/`、`diagnostics/`、`platform/`。模型元数据依赖固定版本并打包进桌面主进程，不重复作为生产依赖树交付。

未迁移 Mona 品牌和用户数据目录、实验性 Team 功能、共享交付策略的提前结束规则。没有 Android 原生工程改造；本次兼容对象是 OBIS/Orbis 系统。

## 兼容修复

本次同时修复并验证了以下实际问题：默认模型未配置时运行时复用访问空对象；切换期间取消请求定位错误；企业范围变化后的迟到进程和通知；并发写入会话归属账本丢失记录；退出登录后企业历史和日志仍可能被读取；归属账本损坏或写入失败被当成本地会话；旧推理环境标志残留；诊断凭据泄漏与单条记录大小超限。

会话归属写入按顺序执行，只有原子持久化成功才发布内存记录。退出登录后仅未归属企业的本地会话可访问；企业必需模式拒绝未登录访问。既有 Orbis 数据目录和业务窗口保留，未对真实用户数据做搬迁。

## 回归结果

| 验证组 | 结果 |
| --- | --- |
| 桌面 Vitest：28 个文件 | 149 项通过 |
| ACP、目标续跑、workflow、子代理、沙箱、OBIS 与应用组合：35 个文件 | 460 项通过 |
| 对话 UI：chat-view、chat-branch-tails | 97 项通过 |
| 桌面 Node 测试：应用运行时、企业范围 | 7 项通过 |
| 目标会话回放快照 | 原有 2 项和新增截断续跑 1 项分别通过 |
| 真实 OBIS Kernel 跨仓库场景 | 13 个场景通过 |

上述自动测试合计 716 项；真实 OBIS 的 13 个场景另列，避免混入单元测试计数。测试按适用运行器和单 worker 执行。早期并行重负载运行出现超时，Vitest 也曾误收集 Node 测试；修正运行方式后通过，不把失败尝试计为成功。

共享回归使用 `pnpm exec vitest run`，覆盖 `packages/acp/acp/tests`、`packages/examples/acp-demo/tests/acp-agent.spec.ts`、`packages/goal/goal-round-driver/tests`、`packages/workflow/workflow-worker-thread/tests`、`packages/subagent/tool-subagent/tests`、`packages/sandbox/sandbox-policy/tests`、`packages/sandbox/sandbox-local/tests`、Windows provider-chain、两个 OBIS 包以及 ACP 应用的 OBIS 转录和 Computer Use 组合测试，参数为 `--maxWorkers=1`。桌面 Vitest 显式排除使用 `node:test` 的文件，后者通过 `node --import tsx/esm --test` 执行。

新增目标快照使用真实应用装配和 ACP 回放，验证连续两次输出截断的轮数、停止原因和目标活动状态。通过 `vitest.snapshot.config.ts` 执行；Node 24 SQLite 的实验警告通过 `NODE_OPTIONS=--disable-warning=ExperimentalWarning` 抑制，未修改业务输出归一化。

真实后端来自本地 `obis-dev/10-kernel`，提交 `59bc710624666468e332bb3c01c66eda615c4e08`。使用独立、临时 PostgreSQL 16 容器执行 `node --import tsx/esm tests/obis-cross-repo.e2e.ts`。覆盖 OIDC 登录、委托租约、上下文/查询/技能、人工审批与动作提交、任务、SSE、权限拒绝、重启持久化与幂等、OHP 冲突。测试结束已停止服务并删除测试容器，未连接生产数据库，未修改 OBIS 后端代码。

## 构建与发布检查

已通过仓库构建、host 库构建、桌面构建、TypeScript 编译、全仓契约 lint 及后续受影响目录 lint、vendor rescope 检查、暂存差异格式检查。文档总检查最初为 27/28 通过；修复失效链接后单独重跑 `verify-md-links` 通过（2109 个文件），未将其描述为再次完整运行了所有文档检查。修改的翻译配对已校验。

macOS ARM64 应用以 `CSC_IDENTITY_AUTO_DISCOVERY=false` 生成未签名预览包，避免本机重复开发签名证书影响打包。最终通过 `pnpm run verify:desktop-dist` 将应用迁到仓库外、使用隔离用户目录启动，验证内置 ACP、浅深主题和输入框样式；该验证无需外部 Node 或仓库路径。Computer Use 在这项分发冒烟中关闭。

`pnpm run hygiene` 尚未全部通过。迁移引入的路径 rescope 问题已修复；剩余 5 类问题为原有发布检查问题：knip 桌面企业入口/既有导出识别、工作区约束中的 OBIS 版本/仓库地址/发布文件配置、源代码运行时 invariant 约定、构建产物 invariant 配置、publint 源导出与动态 CJS 导出。相关既有 manifest 和 invariant 文件没有被修改来绕过检查。因此当前结果是功能迁移与覆盖内回归通过，不能宣称正式发布门禁全部通过。

## 验证边界与产物

本次没有可用真实商业模型 API 凭据，模型请求验证采用本地 HTTP 模型服务、真实 ACP 和固定回放；未验证商业模型网络故障、额度和厂商服务行为。Windows 原生 ACL/安装包、生产部署与真实用户数据迁移未验证。自动测试和本地真实 OBIS 验证提供兼容证据，不能证明所有环境永远不存在缺陷。

- [迁移评估报告](/Users/ikworld/Documents/GitHub/Ai-harness/reports/mona-buddy-sdk-migration-analysis-2026-10-12.zh.md)
- [桌面功能说明](/Users/ikworld/Documents/GitHub/Ai-harness/apps/desktop/README.zh.md)
- [macOS ARM64 未签名预览应用](</Users/ikworld/Documents/GitHub/Ai-harness/apps/desktop/dist-electron/mac-arm64/Orbis AI.app>)
