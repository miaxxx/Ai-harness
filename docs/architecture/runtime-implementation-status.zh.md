# 独立运行时实现状态

[English](runtime-implementation-status.md) | 中文

本分支在一个集成分支上通过一系列小提交实现独立 Agent Runtime 计划。

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
- [ ] JSONL 重启集成测试
- [ ] SQLite 重启集成测试
- [ ] 跨客户端运行时可移植性 e2e

## 阶段 B：客户端分离

- [ ] CLI 产品客户端路径使用 ACP
- [ ] CLI 客户端路径不依赖 Agent Loop
- [ ] CLI 客户端路径不能直接调用工具

## 阶段 C：IDE

- [ ] VS Code 扩展启动 Harness ACP 子进程
- [ ] 加载 CLI 创建的会话
- [ ] 渲染 ACP 更新和权限请求

## 阶段 D：Desktop

- [ ] 主进程监管 Harness ACP 子进程
- [ ] 渲染进程保持无特权
- [ ] 加载 CLI 或 IDE 创建的会话

## 阶段 E：工具治理

- [ ] agent 可触发的副作用清单
- [ ] 静态绕过检查器
- [ ] CI 门禁

## 阶段 F：沙箱覆盖

- [ ] 可创建进程的消费方覆盖审计
- [ ] 一致的 `danger-full-access`、`workspace-write` 和 `read-only` 语义
- [ ] 快速失败覆盖

## 明确延后

本工作不会引入 Redis、消息总线、分布式锁、守护进程、CRDT、通用策略引擎、替代 ACP 协议、虚拟机或容器编排，也不会引入远程传输。
