# OBIS Harness Bridge

Reference AI Harness integration for **OHP 1.x**. This package is intentionally a protocol client and capability adapter; it does not copy OBIS policy, approval, ontology, Source-of-Truth or business workflow logic into Harness.

## Trust boundary

**AI proposes. Runtime decides.**

The model-facing surface contains governed context/query/knowledge/task reads and action proposal creation. It intentionally does **not** expose arbitrary production action execution as a model tool. Final execution is driven through OBIS confirmation/approval and re-enters OBIS ActionRuntime.

Full Harness session/reasoning history remains Harness-owned. The bridge sends only normalized run, proposal, usage and diagnostic metadata required for enterprise audit/trace.

## Authentication

Provide a short-lived OBIS access token with `tokenProvider`. Desktop integrations should obtain/refresh it through browser PKCE/device authorization and store refresh credentials in the operating-system credential store; this package never persists credentials itself.
