# Agent Note: OBIS Cross-Repository Compatibility

Status: implemented

English | [中文](2026-09-07-obis-cross-repo-compatibility.zh.md)

## Problem

OBIS and AI Harness are independently versioned systems joined by OHP. Package-local tests can prove each side in isolation but cannot prove that a real Harness Session can authenticate to a real OBIS Kernel, acquire run-scoped authority, survive persistence boundaries, and execute a governed enterprise mutation without violating the ownership split.

The OBIS repository is private, so an ordinary `GITHUB_TOKEN` issued to an AI Harness workflow cannot check it out. Separately, the OBIS repository's current GitHub Actions infrastructure has an external provisioning failure mode where jobs can terminate before any step starts. Cross-repository evidence must preserve both facts instead of misclassifying repository visibility or runner provisioning as an OHP compatibility failure.

## Decision

The authoritative compatibility workflow is owned by the private `miaxxx/obis-dev` repository. Its repository-scoped `GITHUB_TOKEN` reads OBIS, and it checks out AI Harness at a fixed commit. The optional Harness-owned validation lane requires `OBIS_REPO_TOKEN` and also fixes the OBIS commit. Changing the selected pair requires rerunning the real compatibility tests; a moving branch cannot identify a tested release pair.

The required P0 candidate cell starts the actual OBIS Kernel twice against one PostgreSQL database. A local signed OIDC provider supplies deterministic login without external identity-provider network dependency. Enterprise state is built through the OBIS Pack compiler and deployment APIs, then the authenticated phase uses OHP 1.0 and run-scoped Capability Leases.

The suite exercises the native `tool-obis` plugin through Harness `ToolRuntime`, not a parallel agent loop. It covers context, governed query, skill discovery, proposal creation, the native one-shot human approval seam, adapter-internal proposal execution, task state, restart/resume, response-loss replay, policy denial, and protocol-version rejection. The model-facing registry is also checked to contain no `obis_execute_action` tool.

The selected pair must have equal shared UI registries and pass shared renderer checks, PostgreSQL persistence, authenticated Web-to-Harness handoff and supported database upgrade rehearsals. Human logout must invalidate Web, MCP and Harness delegated credentials, and tickets must reject replay and unavailable project scopes. Release/current and release/previous combinations require real release refs before they can supply evidence.

The OBIS-owned workflow runs on relevant OBIS changes, including candidate branches, manual dispatch, and a daily schedule. A green live matrix is valid cross-repository evidence only when its steps actually run; if the known OBIS runner provisioning fault terminates the job before step execution, the result remains an external CI blocker rather than a product failure.

## Alternatives considered

**Run the private-repository checkout from AI Harness with its ordinary `GITHUB_TOKEN`.** Rejected after live CI proved GitHub returns `Repository not found`: repository-scoped workflow tokens do not grant cross-private-repository read access.

**Store a long-lived cross-repository PAT in AI Harness solely for this matrix.** Rejected for P0 because the same composition can be owned by OBIS without introducing another secret lifecycle. A dedicated GitHub App or organization-level reusable-workflow credential remains a future option if matrix ownership must move.

**Mock the OBIS HTTP service.** Rejected because it would only retest the Bridge contract. The matrix must cross the real Kernel, compiler, policy runtime, AgentRun/Task persistence, Capability Lease validation, and ActionRuntime.

**Expose an execute tool to the model to simplify E2E.** Rejected because it violates the product authority boundary. The live test uses the same human-approval-to-adapter-internal-execute route as production composition.

**Mark unavailable main/release combinations green without distinction.** Rejected because compatibility evidence must distinguish supported pairs, expected incompatibility, and refs that do not yet exist.

## Consequences

The candidate matrix has a permission-correct home: OBIS supplies access to its private source and Harness supplies the public execution engine and E2E scenario code. A network interruption scenario verifies replay after the server has committed but the client discards the response.

The lane is intentionally heavier than package tests and depends on PostgreSQL and both repositories being fetchable. It does not repair the OBIS repository's runner provisioning problem, and a job that never starts its steps cannot be reported as passing. Likewise, green Harness package/Host CI must not be described as green OBIS repository-local PostgreSQL CI.
