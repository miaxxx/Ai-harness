# @deepseek-ai/dsh-tool-obis

Native Harness adapter for OBIS-governed enterprise capabilities.

The plugin registers `obis_context`, `obis_query`, `obis_get_object`, `obis_search_knowledge`, `obis_propose_action`, and `obis_get_task` through the normal Harness tool registry. It does not modify Agent Loop behavior and never implements enterprise Policy, Approval, Ontology, or production mutation locally.

Configuration stores only an OBIS credential **reference**. The actual short-lived access token is resolved through `ctx.credentials` for each operation. `runId` and `capabilityLease` are scoped governance context supplied by the OBIS/Harness session binding layer.

`obis_propose_action` creates a governed proposal only. There is intentionally no model-facing `obis_execute_action` tool; final execution stays behind OBIS confirmation and business approval surfaces.
