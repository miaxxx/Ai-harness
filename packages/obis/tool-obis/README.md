# @deepseek-ai/dsh-tool-obis

Native Harness adapter for OBIS-governed enterprise capabilities.

The plugin registers `obis_context`, `obis_query`, `obis_get_object`, `obis_search_knowledge`, `obis_propose_action`, and `obis_get_task` through the normal Harness tool registry. It does not modify Agent Loop behavior and never implements enterprise Policy, Approval, Ontology, or production mutation locally.

Configuration stores only an OBIS credential **reference**. The actual short-lived access token is resolved through `ctx.credentials` for each operation. For a normal workspace configuration the adapter lazily creates or resumes one OBIS `AgentRun` from the Harness Session's first durable human prompt, attaches the Harness Session id, and uses the returned run-scoped capability lease for subsequent governed calls. `installationId` associates the session with a registered Harness installation so OBIS can issue a device-bound lease. `runId` and `capabilityLease` remain optional explicit overrides for managed or diagnostic compositions.

`obis_propose_action` creates the enterprise proposal; the model is never given an execute tool. If OBIS allows the proposal and the run autonomy permits execution, the native adapter asks through `ctx.approval` inside the same Harness turn. Only an `allowed-once` human outcome lets the adapter submit the proposal to `/v1/harness/proposals/{id}/execute`. OBIS then re-enters current Policy, business Approval, ActionRuntime and idempotency checks before any production mutation. A rejected, unavailable, or cancelled Harness confirmation leaves the proposal unexecuted, and a business approval requirement remains `approval-required` rather than being treated as success.

The model does not manage `AgentRun.version`: the bridge reads current governed run state immediately before proposal creation and uses the version returned by that proposal for any confirmed execution. The tool result records proposal, confirmation and final OBIS execution state in the ordinary Harness Session log, so UI replay and session resume do not require a second transcript store.
