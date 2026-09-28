# Agent Note: Desktop Password Login Against OBIS Kernel

Status: implemented

English | [中文](2026-09-27-desktop-obis-password-login.zh.md)

## Problem

Orbis Desktop already posted email and password to the Kernel, then called `/v1/me` and `/v1/harness/installations`. That sequence lived only inside Electron IPC, so a missing first tenant owner on the Kernel and a broken login envelope could not be proven without launching the packaged app. Kernel HTTP user-create routes require a bearer token, so an empty tenant cannot seed itself through the public API.

## Decision

Desktop password sign-in is a three-step Kernel HTTP sequence owned by `desktop-obis-identity-protocol.ts`: `POST /v1/auth/password/login` without OHP headers, `GET /v1/me` with the issued bearer, then `POST /v1/harness/installations` with `ohp-version: 1.0` and the Desktop capability list. Electron IPC encrypts the resulting tokens; it does not invent a second login client.

The first `obis-dev` owner is created through the Kernel identity store (`putUser`, `putMembership`, `putPasswordCredential`) using the Kernel `scrypt-v1` password hasher. `POST /v1/platform/bootstrap` stays off unless `OBIS_BOOTSTRAP_TOKEN` is configured. Password login remains the Desktop path; GitHub device start is unregistered on the Guangzhou Kernel.

## Alternatives considered

**Open `POST /v1/management/users` without a bearer so Desktop can self-register.** Rejected because directory writes must stay owner/admin operations. An empty tenant is an operator seed, not a public signup.

**Keep login, `/v1/me`, and installation register inline in the Electron main process.** Rejected because package tests cannot load `electron`/`safeStorage`, and A has no product-user transcript to snapshot.

**Reuse the local OIDC cross-repo E2E fixture against `obis-api.obistech.com`.** Rejected because that suite starts its own Kernel and signed issuer; it does not prove Desktop password login against the hosted Kernel.

## Consequences

A configured Desktop can authenticate to `https://obis-api.obistech.com` for tenant `obis-dev` once the identity-store owner exists. Tests in `apps/desktop/tests/identity-password-login.spec.ts` pin the HTTP order, OHP header split, and invalid-envelope rejection. Project and environment seed, ACP `tool-obis` wiring, and governed query/execute remain outside this login path.
