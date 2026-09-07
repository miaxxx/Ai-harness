import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool, type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-user-approval'
import {
  ObisBridgeClient,
  createObisTools,
  type AgentRunBinding,
  type JsonRecord,
  type ObisToolContext,
  type ObisToolDefinition,
} from '@deepseek-ai/dsh-obis-bridge'

export const name = 'tool-obis'
export const inject = ['credentials', 'tools', 'systemPrompt', 'approval']

export type WorkspaceAutonomy = 'read-only' | 'recommend' | 'draft' | 'human-approved' | 'bounded-autonomous'

export interface Config {
  baseUrl: string
  environmentId: string
  credentialRef: string
  installationId?: string
  agentId?: string
  autonomy?: WorkspaceAutonomy
  runId?: string
  capabilityLease?: string
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
  obis_get_task: {
    taskId: { type: 'string' as const, required: true, description: 'Governed OBIS task id.' },
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

function normalizeConfig(config: Config): Required<Pick<Config, 'baseUrl' | 'environmentId' | 'credentialRef' | 'agentId' | 'autonomy'>> & Omit<Config, 'baseUrl' | 'environmentId' | 'credentialRef' | 'agentId' | 'autonomy'> {
  const baseUrl = config.baseUrl.trim()
  const environmentId = config.environmentId.trim()
  const credentialReference = config.credentialRef.trim()
  const agentId = config.agentId?.trim() || 'workspace'
  const autonomy = config.autonomy ?? 'human-approved'
  if (!baseUrl) throw new TypeError('tool-obis baseUrl is required.')
  if (!environmentId) throw new TypeError('tool-obis environmentId is required.')
  if (!credentialReference) throw new TypeError('tool-obis credentialRef is required.')
  credentialRef(credentialReference)
  return {
    baseUrl,
    environmentId,
    credentialRef: credentialReference,
    agentId,
    autonomy,
    ...(config.installationId?.trim() ? { installationId: config.installationId.trim() } : {}),
    ...(config.runId?.trim() ? { runId: config.runId.trim() } : {}),
    ...(config.capabilityLease?.trim() ? { capabilityLease: config.capabilityLease.trim() } : {}),
  }
}

export function apply(ctx: Context, input: Config): void {
  const config = normalizeConfig(input)
  const reference = credentialRef(config.credentialRef)
  const client = new ObisBridgeClient({
    baseUrl: config.baseUrl,
    tokenProvider: async () => (await ctx.credentials.resolve(reference))?.value,
  })
  const definitions = createObisTools(client)
  const bindings = new Map<string, Promise<AgentRunBinding>>()

  const ensureBinding = (agent: Agent): Promise<AgentRunBinding> => {
    const key = String(agent.id)
    const current = bindings.get(key)
    if (current) return current
    const pending = (async () => {
      const run = config.runId
        ? await client.getAgentRun(config.runId, config.environmentId)
        : await client.createAgentRun({
            environmentId: config.environmentId,
            agentId: config.agentId,
            goal: humanGoal(agent),
            autonomy: config.autonomy,
          }, { idempotencyKey: `workspace:${key}` })
      return await client.attachAgentRun(run.id, {
        environmentId: config.environmentId,
        harnessSessionId: key,
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
    return {
      binding,
      context: {
        environmentId: config.environmentId,
        runId: binding.id,
        ...(config.capabilityLease || binding.capabilityLease?.id ? { capabilityLease: config.capabilityLease ?? binding.capabilityLease!.id } : {}),
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
        const proposalResult = await definition.execute(args as JsonRecord, context)
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
      'obis_propose_action creates a governed proposal. When the run permits execution, Harness asks the human for one-shot confirmation and only the adapter may submit that proposal back to OBIS for final policy, business-approval and ActionRuntime execution.',
      'Never describe a proposal as executed unless the tool result contains an OBIS execution result with status executed.',
      'Use named governed queries for enterprise object reads; do not infer missing enterprise facts from local files or model memory.',
    ].join('\n'),
  })
}
