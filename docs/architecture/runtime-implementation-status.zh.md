# 独立运行时实现状态

[English](runtime-implementation-status.md) | 中文

本状态表记录 Standalone Agent Runtime 计划。先完成持久运行时，再接产品客户端；每个标记完成的阶段都有可执行的边界检查或可移植性测试支撑。

## 阶段 A：持久化 ACP

- [x] 架构边界约束
- [x] 纯持久事件投影边界
- [x] 可选 `SessionPersistence` 能力接线
- [x] 支持 cwd 过滤和不透明游标分页的 `session/list`
- [x] 通过 `AgentRegistry.resume()` 统一激活持久会话
- [x] `session/load` 恢复并回放
- [x] `session/resume` 恢复但不回放
- [x] `session/close` 释放实时资源但不删除持久化数据
- [x] 连接清理保留持久会话标识
- [x] JSONL 重启集成测试
- [x] SQLite 重启集成测试
- [x] 跨客户端 / Runtime 可移植性 e2e

验收：ACP 契约测试以及 JSONL / SQLite 重启测试已经证明，原 Harness 实例退出后仍能从持久状态重建历史；回放与实时事件共用同一个投影边界。

## 阶段 B：客户端分离

- [x] CLI 产品客户端路径使用 ACP
- [x] CLI 客户端路径不依赖 Agent / Session / Tool / Sandbox Runtime 内部实现
- [x] CLI 客户端路径不能直接调用模型可见工具
- [x] CLI 机器模式权限处理默认拒绝（fail closed）
- [x] release-shaped built CLI → built ACP Runtime 跨进程 e2e
- [x] 全新 CLI 进程可以列出、加载、回放并继续同一个持久 Session

验收：CI 先构建权威 host release closure，再构建 CLI binary；随后证明进程 A 创建并关闭 Session 后，新的进程仅依靠 Persistence + ACP 就能 list/load/continue。

## 阶段 C：IDE

- [x] VS Code 扩展启动可替换的 Harness ACP 子进程
- [x] Extension Host 只依赖 ACP / 产品客户端 seam，不导入 Runtime 内部实现
- [x] 加载 CLI 创建的会话
- [x] 渲染 ACP 更新和权限请求
- [x] 扩展清理只关闭 transport / live handle，不删除持久 Session

## 阶段 D：Desktop

- [x] 主进程监管 Harness ACP 子进程
- [x] Renderer 保持无特权
- [x] 加载 CLI / IDE 创建的会话
- [x] 权限 UI 只映射 ACP permission choice

## 阶段 E：工具治理

- [x] Agent 可触发副作用清单与边界文档
- [x] 静态绕过检查器
- [x] CI 门禁

检查器阻止模型可见工具自行创建进程 / mutation 副作用路径，同时保留仓库既有且合法的 capability seam。Permission 仍然决定“应不应该”，Sandbox 仍然决定“能不能”。

## 阶段 F：沙箱覆盖

- [ ] 可创建进程的消费方覆盖审计
- [ ] 按消费方家族记录一致的 `danger-full-access`、`workspace-write`、`read-only` 语义
- [ ] fail-closed 覆盖

## 明确延后

本工作不会引入 Redis、消息总线、分布式锁、守护进程、CRDT、通用策略引擎、替代 ACP 协议、虚拟机或容器编排，也不会引入远程传输。
