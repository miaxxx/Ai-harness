# Agent Note: OBIS Cross-Repository Compatibility

Status: implemented

## Problem

OBIS and AI Harness are independently versioned systems joined by OHP. Package-local tests can prove each side in isolation but cannot prove that a real Harness Session can authenticate to a real OBIS Kernel, acquire run-scoped authority, survive persistence boundaries, and execute a governed enterprise mutation without violating the ownership split.

The OBIS repository is private, so an ordinary `GITHUB_TOKEN` issued to an AI Harness workflow cannot check it out. Separately, the OBIS repository's current GitHub Actions infrastructure has an external provisioning failure mode where jobs can terminate before any step starts. Cross-repository evidence must preserve both facts instead of misclassifying repository visibility or runner provisioning as an OHP compatibility failure.

## Decision

The live P0 compatibility matrix is owned by the private `miaxxx/obis-dev` repository. Its repository-scoped `GITHUB_TOKEN` can read the selected OBIS ref, while the public `miaxxx/Ai-harness` candidate can be checked out without granting Harness a long-lived cross-repository credential. AI Harness keeps the executable E2E scenario source and native-adapter behavior tests because those scenarios drive Harness `ToolRuntime` and `tool-obis`; OBIS owns the workflow that composes both repositories.

The required P0 candidate cell starts the actual OBIS Kernel twice against one PostgreSQL database. A local signed OIDC provider supplies deterministic login without external identity-provider network dependency. Enterprise state is built through the OBIS Pack compiler and deployment APIs, then the authenticated phase uses OHP 1.0 and run-scoped Capability Leases.

The suite exercises the native `tool-obis` plugin through Harness `ToolRuntime`, not a parallel agent loop. It covers context, governed query, skill discovery, proposal creation, the native one-shot human approval seam, adapter-internal proposal execution, task state, restart/resume, response-loss replay, policy denial, and protocol-version rejection. The model-facing registry is also checked to contain no `obis_execute_action` tool.

A second matrix cell records `OBIS main × Harness candidate` as expected incompatible while OHP 1.0 exists only on the P0 branch. That cell deliberately fails when main gains the OHP contract so maintainers must promote it to the full suite instead of silently preserving an obsolete expected-failure baseline. Release/current and release/previous cells are not fabricated before release refs exist.

The OBIS-owned workflow runs on relevant OBIS changes, manual dispatch, and a daily schedule. A green live matrix is valid cross-repository evidence only when its steps actually run; if the known OBIS runner provisioning fault terminates the job before step execution, the result remains an external CI blocker rather than a product failure.

## Alternatives considered

**Run the private-repository checkout from AI Harness with its ordinary `GITHUB_TOKEN`.** Rejected after live CI proved GitHub returns `Repository not found`: repository-scoped workflow tokens do not grant cross-private-repository read access.

**Store a long-lived cross-repository PAT in AI Harness solely for this matrix.** Rejected for P0 because the same composition can be owned by OBIS without introducing another secret lifecycle. A dedicated GitHub App or organization-level reusable-workflow credential remains a future option if matrix ownership must move.

**Mock the OBIS HTTP service.** Rejected because it would only retest the Bridge contract. The matrix must cross the real Kernel, compiler, policy runtime, AgentRun/Task persistence, Capability Lease validation, and ActionRuntime.

**Expose an execute tool to the model to simplify E2E.** Rejected because it violates the product authority boundary. The live test uses the same human-approval-to-adapter-internal-execute route as production composition.

**Mark unavailable main/release combinations green without distinction.** Rejected because compatibility evidence must distinguish supported pairs, expected incompatibility, and refs that do not yet exist.

## Consequences

The candidate matrix has a permission-correct home: OBIS supplies access to its private source and Harness supplies the public execution engine and E2E scenario code. A network interruption scenario verifies replay after the server has committed but the client discards the response.

The lane is intentionally heavier than package tests and depends on PostgreSQL and both repositories being fetchable. It does not repair the OBIS repository's runner provisioning problem, and a job that never starts its steps cannot be reported as passing. Likewise, green Harness package/Host CI must not be described as green OBIS repository-local PostgreSQL CI.
