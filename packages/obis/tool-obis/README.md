# @deepseek-ai/dsh-tool-obis

English | [中文](README.zh.md)

Native Harness adapter for OBIS-governed enterprise capabilities.

The plugin registers `obis_context`, `obis_query`, `obis_get_object`, `obis_search_knowledge`, `obis_propose_action`, `obis_list_tasks`, `obis_get_task`, `obis_list_approvals`, `obis_list_skills`, `obis_get_skill`, and `obis_next_run_event` through the normal Harness tool registry. `obis_list_tasks` and `obis_list_approvals` read Kernel inbox collections; they do not decide an approval. `obis_list_skills` lists Kernel IR skill ids for the current deployment, and `obis_get_skill` loads one definition; neither starts a skill-runtime sandbox. The plugin does not modify Agent Loop behavior and never implements enterprise Policy, Approval, Ontology, or production mutation locally.

Configuration stores only an OBIS credential **reference**. The actual short-lived access token is resolved through `ctx.credentials` for each operation. For a normal workspace configuration the adapter lazily creates or resumes one OBIS `AgentRun` from the Harness Session's first durable human prompt, attaches the Harness Session id, and uses the returned run-scoped capability lease for subsequent governed calls. `installationId` associates the session with a registered Harness installation so OBIS can issue a device-bound lease. `runId` and `capabilityLease` remain optional explicit overrides for managed or diagnostic compositions. `projectId` and `applicationModuleId` must be supplied together when present; they stamp a published module snapshot onto created AgentRuns. When those config fields are omitted, the adapter reads the same pair from optional Host `obisLaunch` after a successful `module-page`. Unbound runs remain workspace-wide AI.

`obis_propose_action` creates the enterprise proposal; the model is never given an execute tool. If OBIS allows the proposal and the run autonomy permits execution, the native adapter asks through `ctx.approval` inside the same Harness turn. Only an `allowed-once` human outcome lets the adapter submit the proposal to `/v1/harness/proposals/{id}/execute`. OBIS then re-enters current Policy, business Approval, ActionRuntime and idempotency checks before any production mutation. A rejected, unavailable, or cancelled Harness confirmation leaves the proposal unexecuted, and a business approval requirement remains `approval-required` rather than being treated as success.

The model does not manage `AgentRun.version`: the bridge reads current governed run state immediately before proposal creation and uses the version returned by that proposal for any confirmed execution. The tool result records proposal, confirmation and final OBIS execution state in the ordinary Harness Session log, so UI replay and session resume do not require a second transcript store.

`obis_next_run_event` reads one public event from the bound Run through authenticated SSE and closes the connection. An optional `afterId` resumes after a returned event. `eventReadTimeoutMs` bounds the wait (default 5000 ms); timeout returns `event: null` and `timedOut: true`, while caller cancellation and Kernel refusal remain errors. The lease stays in Host request headers and is absent from the result. This read does not complete a task.

A durable human business reference selects a Module before tool execution. The adapter checks `workspaceProjectId` and environment, creates a separate Run for the selected Module version, and retains the original Harness Session id for attachment. Follow-ups retain the latest human selection. `referenceAutonomy` defaults to read-only; human-approved permits the existing proposal-confirm-execute flow. One prompt cannot combine different Module versions or scopes. A changed publication version rejects the reference before a governed operation.

## Model Experience

### Enterprise guidance

#### What the model sees

The `tool:obis` section directs enterprise reads and proposals through OBIS and distinguishes proposals from completed execution.

##### Guidance text

```markdown
OBIS is the enterprise authority. Use obis_* tools for enterprise facts and governed operations.
The Harness Session is bound to one durable OBIS AgentRun before enterprise tools execute; OBIS owns its task, deployment pin, policy and capability lease.
obis_propose_action creates a governed proposal. When the run permits execution, Harness asks the human for one-shot confirmation and only the adapter may submit that proposal back to OBIS for final policy, business-approval and ActionRuntime execution.
Never describe a proposal as executed unless the tool result contains an OBIS execution result with status executed.
Use named governed queries for enterprise object reads; do not infer missing enterprise facts from local files or model memory.
obis_list_tasks, obis_list_approvals, and obis_list_skills list Kernel-visible inbox and catalog ids for this deployment. They do not decide approvals or start a skill-runtime.
obis_get_skill loads a Kernel IR skill definition for the current deployment. Follow that definition; do not invent skill steps or start a local skill-runtime.
```

#### Token effect

The fixed guidance contributes tokens to each model request in a session with this plugin mounted. Enterprise results add transcript tokens; secrets stay in Host credential storage.

#### KV Cache effect

The guidance is stable across calls. Changes to composed prompt sections or tool results may shorten the reusable prefix; provider cache behavior remains provider-owned.

### Tool schemas

#### What the model sees

The [OBIS tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-obis) lists the registered tools and their arguments. Results include governed reads, proposal decisions and, after human confirmation, execution state.

#### Token effect

Registered `obis_*` definitions contribute schema tokens. Result size depends on the query, inbox or skill response; bounded limits reduce returned records.

#### KV Cache effect

Stable tool definitions can reuse the request prefix. Recorded results and confirmation outcomes change the transcript suffix.

## Known Limitations and Deferred Work

Before a tool call, an expired Host-managed capability lease is renewed by attaching the same Run and Harness Session. Concurrent callers share the attachment request. A stale renewal fails before the governed operation is sent. An explicitly configured lease remains owned by its issuer and is not replaced by this cache. Server denials are not operation retries.

- The plugin requires OBIS Kernel, a credential provider and an approval service. Missing or cancelled human confirmation leaves proposals unexecuted. Business approval can remain pending after Harness confirmation. Skill tools read definitions without starting a skill sandbox; login, refresh and application rendering belong to their client plugins.
