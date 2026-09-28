# Agent Note: Desktop Password Login Against OBIS Kernel

Status: implemented

[English](2026-09-27-desktop-obis-password-login.md) | 中文

## Problem

Orbis Desktop 已经把邮箱和密码发到 Kernel，再调用 `/v1/me` 与 `/v1/harness/installations`。该序列只活在 Electron IPC 里，因此 Kernel 缺少第一个租户 owner、或登录信封损坏时，无法在不启动打包应用的情况下证明。Kernel 的 HTTP 建用户路由需要 Bearer，空租户不能通过公开 API 自举。

## Decision

Desktop 密码登录是 `desktop-obis-identity-protocol.ts` 拥有的三步 Kernel HTTP 序列：`POST /v1/auth/password/login` 不带 OHP 头，用签发的 Bearer 调用 `GET /v1/me`，再以 `ohp-version: 1.0` 和 Desktop 能力列表调用 `POST /v1/harness/installations`。Electron IPC 加密得到的令牌；它不另造第二条登录客户端。

第一个 `obis-dev` owner 通过 Kernel identity store（`putUser`、`putMembership`、`putPasswordCredential`）创建，并使用 Kernel 的 `scrypt-v1` 密码哈希。除非配置了 `OBIS_BOOTSTRAP_TOKEN`，否则 `POST /v1/platform/bootstrap` 保持关闭。Desktop 路径仍是密码登录；广州 Kernel 上未注册 GitHub device start。

## Alternatives considered

**让 `POST /v1/management/users` 在无 Bearer 时可调用，以便 Desktop 自行注册。** 拒绝，因为目录写入必须仍是 owner/admin 操作。空租户是运营种子，不是公开注册。

**把登录、`/v1/me` 与 installation 注册留在 Electron 主进程内联。** 拒绝，因为包测试无法加载 `electron`/`safeStorage`，且 A 没有可快照的产品用户 transcript。

**把本地 OIDC 跨仓 E2E fixture 对着 `obis-api.obistech.com` 跑。** 拒绝，因为该套件会自起 Kernel 和签名 issuer；它不能证明 Desktop 密码登录打到托管 Kernel。

## Consequences

一旦 identity store 中存在 owner，已配置的 Desktop 就可以向 `https://obis-api.obistech.com` 认证租户 `obis-dev`。`apps/desktop/tests/identity-password-login.spec.ts` 钉住 HTTP 顺序、OHP 头拆分以及非法信封拒绝。project/environment 种子、ACP `tool-obis` 接线以及治理查询/执行仍不在这条登录路径内。
