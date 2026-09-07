# Agent Note: OBIS Cross-Repository Compatibility

Status: implemented

## Problem

OBIS and AI Harness are independently versioned systems joined by OHP. Package-local tests can prove each side in isolation but cannot prove that a real Harness Session can authenticate to a real OBIS Kernel, acquire run-scoped authority, survive persistence boundaries, and execute a governed enterprise mutation without violating the ownership split.

The OBIS repository's current GitHub Actions runner also has an external provisioning failure mode where jobs can terminate before any step starts. Treating that repository-local signal as the only integration gate would leave the cross-repository seam without executable evidence.

## Decision

AI Harness owns a cross-repository P0 compatibility workflow that checks out a selected `miaxxx/obis-dev` ref and runs the live candidate pair on a functioning Harness-hosted GitHub Actions runner with PostgreSQL 16.

The required P0 candidate cell starts the actual OBIS Kernel twice against one PostgreSQL database. A local signed OIDC provider supplies deterministic login without external identity-provider network dependency. Enterprise state is built through the OBIS Pack compiler and deployment APIs, then the authenticated phase uses OHP 1.0 and run-scoped Capability Leases.

The suite exercises the native `tool-obis` plugin through Harness `ToolRuntime`, not a parallel agent loop. It covers context, governed query, skill discovery, proposal creation, the native one-shot human approval seam, adapter-internal proposal execution, task state, restart/resume, response-loss replay, policy denial, and protocol-version rejection. The model-facing registry is also checked to contain no `obis_execute_action` tool.

A second matrix cell records `OBIS main × Harness candidate` as expected incompatible while OHP 1.0 exists only on the P0 branch. That cell deliberately fails when main gains the OHP contract so maintainers must promote it to the full suite instead of silently preserving an obsolete expected-failure baseline. Release/current and release/previous cells are not fabricated before release refs exist.

The workflow runs on relevant Harness changes, manual dispatch, and a daily schedule so changes in the separately hosted OBIS repository are eventually observed even though one repository's ordinary push event cannot directly trigger the other's workflow with the default token.

## Alternatives considered

**Run the matrix only in the OBIS repository.** Rejected for P0 because the current OBIS Actions infrastructure can fail before step execution and therefore cannot provide reliable integration evidence. The Harness-hosted lane does not claim that the OBIS repository-local runner is fixed; it provides an independent execution surface for the same source.

**Mock the OBIS HTTP service.** Rejected because it would only retest the Bridge contract. The matrix must cross the real Kernel, compiler, policy runtime, AgentRun/Task persistence, Capability Lease validation, and ActionRuntime.

**Expose an execute tool to the model to simplify E2E.** Rejected because it violates the product authority boundary. The live test uses the same human-approval-to-adapter-internal-execute route as production composition.

**Mark unavailable main/release combinations green without distinction.** Rejected because compatibility evidence must distinguish supported pairs, expected incompatibility, and refs that do not yet exist.

## Consequences

The P0 candidate pair now has one executable acceptance lane whose evidence crosses repository, process, authentication, protocol, persistence, policy, approval, and execution boundaries. A network interruption test specifically verifies replay after the server has committed but the client discards the response.

The lane is intentionally heavier than package tests and depends on PostgreSQL and both repositories being fetchable. It does not repair or replace the OBIS repository's own CI infrastructure, and a green cross-repo lane must not be reported as a green OBIS repository-local PostgreSQL job.
