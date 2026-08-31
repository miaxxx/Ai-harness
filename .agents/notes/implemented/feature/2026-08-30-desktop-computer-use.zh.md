# Agent Note: Desktop 受控 Computer Use

Status: implemented

[English](2026-08-30-desktop-computer-use.md) | 中文

## 问题

Desktop 会话可以使用文件系统、Shell 和 Web 搜索工具，但在任务确实需要可见 UI 验证时，无法检查或操作浏览器与原生应用。若直接赋予模型不受限制的键盘、鼠标或脚本执行权，会以不安全的方式填补这一缺口。

## 决策

**`ctx.computer` 是按 Provider 选择的电脑控制能力，`computer` 是其唯一具备授权意识的面向模型消费者。**

- `dsh-computer` 拥有应用发现、受限快照和小粒度输入操作。Provider 返回临时元素 id；服务选择一个已配置且可用的 Provider，不依赖注册顺序。
- `dsh-computer-browser-cdp` 在存在 `DSH_BROWSER_CDP_URL` 时使用本机 Chromium DevTools 端点。它检查选中的页面并只发送固定的 DevTools 操作；不会启动浏览器，也不会运行模型编写的脚本。
- `dsh-computer-macos` 对选中的应用使用固定 JXA 辅助功能操作，绝不把模型文本解释为 JXA。macOS 将辅助功能和屏幕录制权限授予 ACP Runtime 进程。
- `dsh-tool-computer` 会为每次截图、点击、输入、按键与滚动通过 `ctx.approval` 请求授权。仅文本检查保持只读。截图经过 `ctx.attachments`，因此其模型可见像素是持久化工具结果内容。
- Desktop 在用户于主模型设置中启用前保持 Computer Use 关闭。本机 DevTools 端点优先于 macOS 可视化控制；每个改变状态的操作仍进入现有 ACP 授权 UI。

## 考虑过的替代方案

**模型直接调用 AppleScript。** 已拒：接受任意 JXA 会使模型回复成为主机命令语言，也无法保留狭窄的操作词汇。

**仅坐标 GUI 自动化。** 不作为首选：辅助功能和 DevTools 元素可以检查，也能承受常规布局变化。没有可用辅助功能表面的控件仍留待视觉坐标兜底。

**按应用的持久授权。** 不用于初始 Desktop 能力：一次性授权将可见操作与用户决定保持相邻，同时产品建立可靠的权限体验。

## 后果

当用户启动本机调试端点时，浏览器任务使用结构化 DevTools 自动化。原生 macOS 任务只会在用户启用功能并授予操作系统权限后使用辅助功能。元素 id 会失效，因此模型每个操作后重新检查。该设计不增加现有工具之外的进程、文件系统或终端权限；代价是每次敏感操作都要确认，视觉坐标兜底仍在该能力之外。
