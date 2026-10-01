import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool, type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-user-approval'
import { createRunEventTool } from './run-events.ts'
import {
  ObisBridgeClient,
  createObisTools,
  readObisBusinessReferences,
  type AgentRunBinding,
  type JsonRecord,
  type ObisToolContext,
  type ObisToolDefinition,
} from '@deepseek-ai/dsh-obis-bridge'

export const name = 'tool-obis'
export const inject = ['credentials', 'tools', 'systemPrompt', 'approval']

/** Workspace autonomy forwarded onto created AgentRuns when config omits `runId`. */
export type WorkspaceAutonomy = 'read-only' | 'recommend' | 'draft' | 'human-approved' | 'bounded-autonomous'

/** Native OBIS tool adapter configuration. Token values stay in `ctx.credentials`. */
export interface Config {
  /** OBIS Kernel HTTP base URL. */
  baseUrl: string
  /** Environment checked by Kernel for every governed call. */
  environmentId: string
  /** Host credential reference resolved for each operation. */
  credentialRef: string
  /** Registered Harness installation used for device-bound leases. */
  installationId?: string
  /** Agent identity recorded on created runs; defaults to workspace. */
  agentId?: string
  /** Requested run autonomy; defaults to human-approved. */
  autonomy?: WorkspaceAutonomy
  /** Existing governed run; must be paired with capabilityLease. */
  runId?: string
  /** Lease for an existing run; must be paired with runId. */
  capabilityLease?: string
  /** Project id stamped onto created AgentRuns. Must be paired with applicationModuleId. */
  projectId?: string
  /** Published application module id stamped onto created AgentRuns. Must be paired with projectId. */
  applicationModuleId?: string
  /** Validated workspace project restricting user-selected business references. */
  workspaceProjectId?: string
  /** Autonomy for explicitly referenced Modules; defaults to read-only. */
  referenceAutonomy?: 'read-only' | 'human-approved'
  /** Maximum wait for a public SSE event; defaults to 5000 milliseconds. */
  eventReadTimeoutMs?: number
}

export const Config = z.object({
  baseUrl: z.string(),
  environmentId: z.string(),
  credentialRef: z.string(),
  installationId: z.string(),
  agentId: z.string().default('workspace'),
  autonomy: z.union(['read-only', 'recommend', 'draft', 'human-approved', 'bounded-autonomous'] as const).default('human-approved'),
  runId: z.string(),
  capabilityLease: z.string(),
  projectId: z.string(),
  applicationModuleId: z.string(),
  workspaceProjectId: z.string(),
  referenceAutonomy: z.union(['read-only', 'human-approved'] as const).default('read-only'),
  eventReadTimeoutMs: z.number().default(5000),
})

const output = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const schemas = {
  obis_context: {
    focus: { type: 'json' as const, description: 'Optional bounded context focus.' },
    maxSymbols: { type: 'integer' as const, description: 'Maximum symbols per requested category.' },
  },
  obis_query: {
    query: { type: 'string' as const, required: true, description: 'Named governed OBIS query.' },
    id: { type: 'string' as const, description: 'Optional exact object id.' },
    where: { type: 'json' as const, description: 'Optional governed query predicate values.' },
    limit: { type: 'integer' as const, description: 'Maximum result count.' },
  },
  obis_get_object: {
    query: { type: 'string' as const, required: true, description: 'Named governed query used to read this object type.' },
    id: { type: 'string' as const, required: true, description: 'Enterprise object id.' },
  },
  obis_search_knowledge: {
    query: { type: 'string' as const, required: true, description: 'Enterprise knowledge search text.' },
    limit: { type: 'integer' as const, description: 'Maximum result count.' },
  },
  obis_propose_action: {
    action: { type: 'string' as const, required: true, description: 'Named governed OBIS action.' },
    targetId: { type: 'string' as const, description: 'Optional target object id.' },
    expectedObjectVersion: { type: 'integer' as const, description: 'Optional optimistic object version.' },
    input: { type: 'json' as const, required: true, description: 'Action input object.' },
  },
  obis_list_tasks: {
    status: { type: 'string' as const, description: 'Optional governed task status filter.' },
    limit: { type: 'integer' as const, description: 'Maximum result count.' },
  },
  obis_get_task: {
    taskId: { type: 'string' as const, required: true, description: 'Governed OBIS task id.' },
  },
  obis_list_approvals: {
    status: { type: 'string' as const, description: 'Optional governed approval status filter.' },
  },
  obis_list_skills: {},
  obis_get_skill: {
    skillId: { type: 'string' as const, required: true, description: 'Governed OBIS skill id from the active deployment.' },
  },
  obis_next_run_event: {
    afterId: { type: 'string' as const, description: 'Resume after a previously returned event id.' },
  },
} as const

type ToolName = keyof typeof schemas

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function humanGoal(agent: Agent): string {
  for (const event of agent.session.events) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = event.data.content
      .filter((block): block is Extract<(typeof event.data.content)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text.trim())
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }
  throw new Error('OBIS workspace binding requires a durable human prompt in the Harness Session.')
}

function proposalParts(value: unknown): { run: JsonRecord; proposal: JsonRecord } | undefined {
  const envelope = record(value)
  const run = record(envelope?.run)
  const proposal = record(envelope?.proposal)
  return run && proposal ? { run, proposal } : undefined
}

function proposalAllowed(proposal: JsonRecord): boolean {
  const decision = record(proposal.decision)
  return decision?.allowed === true
}

function executionAllowed(run: JsonRecord): boolean {
  return run.autonomy === 'draft' || run.autonomy === 'human-approved' || run.autonomy === 'bounded-autonomous'
}

function proposalReason(proposal: JsonRecord, action: string): string {
  const decision = record(proposal.decision)
  const reason = typeof decision?.reason === 'string' ? decision.reason : undefined
  return reason
    ? `Execute governed OBIS proposal for ${action}. OBIS policy: ${reason}`
    : `Execute governed OBIS proposal for ${action}.`
}

function findDefinition(definitions: readonly ObisToolDefinition[], toolName: ToolName): ObisToolDefinition {
  const definition = definitions.find(candidate => candidate.name === toolName)
  if (!definition) throw new Error(`OBIS tool definition ${toolName} is unavailable.`)
  return definition
}

function configModuleBinding(config: Config): { projectId: string; applicationModuleId: string } | undefined {
  const projectId = config.projectId?.trim()
  const applicationModuleId = config.applicationModuleId?.trim()
  if (!projectId && !applicationModuleId) return undefined
  if (!projectId || !applicationModuleId) {
    throw new TypeError('tool-obis projectId and applicationModuleId must be supplied together.')
  }
  return { projectId, applicationModuleId }
}

function launchModuleBinding(ctx: Context): { projectId: string; applicationModuleId: string } | undefined {
  let launch: unknown
  try {
    launch = (ctx as unknown as { obisLaunch?: unknown }).obisLaunch
  } catch {
    // Optional Host service: Cordis throws when obis-launch is not composed into this context.
    return undefined
  }
  if (!launch || typeof launch !== 'object') return undefined
  const source = launch as {
    snapshot?: () => { projectId?: string } | undefined
    applicationModuleId?: () => string | undefined
  }
  const projectId = typeof source.snapshot === 'function' ? source.snapshot()?.projectId?.trim() : undefined
  const applicationModuleId = typeof source.applicationModuleId === 'function' ? source.applicationModuleId()?.trim() : undefined
  if (!projectId || !applicationModuleId) return undefined
  return { projectId, applicationModuleId }
}

function normalizeConfig(config: Config): Required<Pick<Config, 'baseUrl' | 'environmentId' | 'credentialRef' | 'agentId' | 'autonomy' | 'eventReadTimeoutMs'>> & Omit<Config, 'baseUrl' | 'environmentId' | 'credentialRef' | 'agentId' | 'autonomy' | 'eventReadTimeoutMs'> {
  const baseUrl = config.baseUrl.trim()
  const environmentId = config.environmentId.trim()
  const credentialReference = config.credentialRef.trim()
  const agentId = config.agentId?.trim() || 'workspace'
  const autonomy = config.autonomy ?? 'human-approved'
  const eventReadTimeoutMs = config.eventReadTimeoutMs ?? 5000
  if (!Number.isSafeInteger(eventReadTimeoutMs) || eventReadTimeoutMs <= 0) throw new TypeError('OBIS eventReadTimeoutMs must be a positive integer.')
  if (!baseUrl) throw new TypeError('tool-obis baseUrl is required.')
  if (!environmentId) throw new TypeError('tool-obis environmentId is required.')
  if (!credentialReference) throw new TypeError('tool-obis credentialRef is required.')
  credentialRef(credentialReference)
  const moduleBinding = configModuleBinding(config)
  return {
    baseUrl,
    environmentId,
    credentialRef: credentialReference,
    agentId,
    autonomy,
    eventReadTimeoutMs,
    ...(config.installationId?.trim() ? { installationId: config.installationId.trim() } : {}),
    ...(config.runId?.trim() ? { runId: config.runId.trim() } : {}),
    ...(config.capabilityLease?.trim() ? { capabilityLease: config.capabilityLease.trim() } : {}),
    ...(config.workspaceProjectId?.trim() ? { workspaceProjectId: config.workspaceProjectId.trim() } : {}),
    referenceAutonomy: config.referenceAutonomy ?? 'read-only',
    ...(moduleBinding ? { projectId: moduleBinding.projectId, applicationModuleId: moduleBinding.applicationModuleId } : {}),
  }
}

export function apply(ctx: Context, input: Config): void {
  const config = normalizeConfig(input)
  const reference = credentialRef(config.credentialRef)
  const client = new ObisBridgeClient({
    baseUrl: config.baseUrl,
    tokenProvider: async () => (await ctx.credentials.resolve(reference))?.value,
  })
  const definitions = [...createObisTools(client), createRunEventTool(client, config.eventReadTimeoutMs)]
  const bindings = new Map<string, Promise<AgentRunBinding>>()

  const ensureBinding = async (agent: Agent): Promise<AgentRunBinding> => {
    let selected: ReturnType<typeof readObisBusinessReferences>[number] | undefined
    for (const event of [...agent.session.events].reverse()) {
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
      const refs = readObisBusinessReferences(event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
      if (refs.length === 0) continue
      const identities = new Set(refs.map(ref => JSON.stringify([ref.projectId, ref.environmentId, ref.moduleId, ref.moduleVersion])))
      if (identities.size > 1) throw new Error('每轮对话请引用同一个业务模块；跨模块操作需分别确认。')
      selected = refs[0]
      break
    }
    if (selected && selected.environmentId !== config.environmentId) throw new Error('引用业务的环境与当前运行环境不一致。')
    if (selected && config.workspaceProjectId && selected.projectId !== config.workspaceProjectId) throw new Error('引用业务不属于当前工作区。')
    if (selected?.kind === 'module' && selected.moduleId === undefined) throw new TypeError('Module reference requires moduleId.')
    const selection = selected?.kind === 'module'
      ? { projectId: selected.projectId, applicationModuleId: selected.moduleId as string }
      : undefined
    const sessionKey = String(agent.id)
    const autonomy = selection ? config.referenceAutonomy ?? 'read-only' : config.autonomy
    const key = selection
      ? JSON.stringify([sessionKey, selection.projectId, selection.applicationModuleId, selected?.moduleVersion, autonomy]) : sessionKey
    const current = bindings.get(key)
    if (current) {
      const binding = await current
      if (config.capabilityLease || !binding.capabilityLease) return binding
      const expiresAt = Date.parse(binding.capabilityLease.expiresAt)
      if (!Number.isFinite(expiresAt)) throw new TypeError('OBIS capability lease has an invalid expiry.')
      if (expiresAt > Date.now()) return binding
      if (bindings.get(key) !== current) return ensureBinding(agent)
      const renewed = (async () => {
        const attached = await client.attachAgentRun(binding.id, {
          environmentId: config.environmentId, harnessSessionId: sessionKey,
          ...(config.installationId ? { installationId: config.installationId } : {}),
        })
        const expiry = Date.parse(attached.capabilityLease?.expiresAt ?? '')
        if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new TypeError('OBIS did not renew the capability lease.')
        return attached
      })()
      bindings.set(key, renewed)
      void renewed.catch(() => { if (bindings.get(key) === renewed) bindings.delete(key) })
      return renewed
    }
    const pending = (async () => {
      const moduleBinding = selection ?? ((config.projectId && config.applicationModuleId)
        ? { projectId: config.projectId, applicationModuleId: config.applicationModuleId }
        : launchModuleBinding(ctx))
      if (selection && config.projectId && selection.projectId !== config.projectId) throw new Error('引用业务不属于当前项目。')
      const run = config.runId
        ? await client.getAgentRun(config.runId, config.environmentId)
        : await client.createAgentRun({
          environmentId: config.environmentId,
          agentId: config.agentId,
          goal: humanGoal(agent),
          autonomy,
          ...(moduleBinding ? { projectId: moduleBinding.projectId, applicationModuleId: moduleBinding.applicationModuleId } : {}),
        }, { idempotencyKey: `workspace:${key}` })
      if (selection) {
        const module = record(run.moduleBinding)
        if (module?.moduleId !== selection.applicationModuleId || module.projectId !== selection.projectId
          || module.version !== selected?.moduleVersion) throw new Error('引用业务版本已变化，请重新选择已发布业务。')
      }
      return await client.attachAgentRun(run.id, {
        environmentId: config.environmentId,
        harnessSessionId: sessionKey,
        ...(config.installationId ? { installationId: config.installationId } : {}),
      })
    })()
    bindings.set(key, pending)
    void pending.catch(() => {
      if (bindings.get(key) === pending) bindings.delete(key)
    })
    return pending
  }

  const toolContext = async (exec: ToolRunContext): Promise<{ context: ObisToolContext; binding: AgentRunBinding }> => {
    if (!exec.agent) throw new Error('OBIS tools require an active Harness Agent scope.')
    const binding = await ensureBinding(exec.agent)
    const capabilityLease = config.capabilityLease ?? binding.capabilityLease?.id
    return {
      binding,
      context: {
        environmentId: config.environmentId,
        runId: binding.id,
        ...(capabilityLease ? { capabilityLease } : {}),
        signal: exec.signal,
        idempotencyKey: `tool:${String(exec.callId)}`,
      },
    }
  }

  for (const toolName of Object.keys(schemas) as ToolName[]) {
    const definition = findDefinition(definitions, toolName)
    ctx.tools.register(defineTool({
      name: toolName,
      description: definition.description,
      parameters: schemas[toolName],
      output,
      execute: async (args, exec) => {
        const { context, binding } = await toolContext(exec)
        const proposalResult = await definition.execute(args, context)
        if (toolName !== 'obis_propose_action') return proposalResult as JsonValue

        const parts = proposalParts(proposalResult)
        if (!parts || !proposalAllowed(parts.proposal) || !executionAllowed(parts.run)) {
          return proposalResult as JsonValue
        }
        if (!exec.agent) throw new Error('OBIS proposal confirmation requires an active Harness Agent scope.')
        const action = typeof (args as JsonRecord).action === 'string' ? String((args as JsonRecord).action) : 'enterprise action'
        const outcome = await ctx.approval.request({
          agent: exec.agent,
          toolName: 'obis_propose_action',
          callId: exec.callId,
          reason: proposalReason(parts.proposal, action),
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          return {
            proposal: proposalResult as JsonValue,
            confirmation: { outcome },
            execution: { status: 'not-executed' },
          }
        }
        const proposalId = parts.proposal.id
        const runVersion = parts.run.version
        if (typeof proposalId !== 'string' || typeof runVersion !== 'number') {
          throw new Error('OBIS proposal response is missing proposal id or governed run version.')
        }
        const execution = await client.executeProposal(proposalId, {
          environmentId: config.environmentId,
          runId: binding.id,
          expectedVersion: runVersion,
        }, {
          agentRunId: binding.id,
          ...(context.capabilityLease ? { capabilityLease: context.capabilityLease } : {}),
          idempotencyKey: `execute:${String(exec.callId)}:${proposalId}`,
          signal: exec.signal,
        })
        return {
          proposal: proposalResult as JsonValue,
          confirmation: { outcome },
          execution: execution as JsonValue,
        }
      },
    }))
  }

  ctx.systemPrompt.section({
    name: 'tool:obis',
    order: 145,
    text: [
      'OBIS is the enterprise authority. Use obis_* tools for enterprise facts and governed operations.',
      'The Harness Session is bound to one durable OBIS AgentRun before enterprise tools execute; OBIS owns its task, deployment pin, policy and capability lease.',
      'A durable human obis-reference selects a published Module and pins its version. Follow-up requests retain that selection until the human selects another business area. References do not grant permission; stale versions and cross-workspace selections are refused.',
      'obis_propose_action creates a governed proposal. When the run permits execution, Harness asks the human for one-shot confirmation and only the adapter may submit that proposal back to OBIS for final policy, business-approval and ActionRuntime execution.',
      'Never describe a proposal as executed unless the tool result contains an OBIS execution result with status executed.',
      'Use named governed queries for enterprise object reads; do not infer missing enterprise facts from local files or model memory.',
      'obis_list_tasks, obis_list_approvals, and obis_list_skills list Kernel-visible inbox and catalog ids for this deployment. They do not decide approvals or start a skill-runtime.',
      'obis_get_skill loads a Kernel IR skill definition for the current deployment. Follow that definition; do not invent skill steps or start a local skill-runtime.',
    ].join('\n'),
  })
}
