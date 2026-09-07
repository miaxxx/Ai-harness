import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool, type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  ObisBridgeClient,
  createObisTools,
  type JsonRecord,
  type ObisToolContext,
  type ObisToolDefinition,
} from '@deepseek-ai/dsh-obis-bridge'

export const name = 'tool-obis'
export const inject = ['credentials', 'tools', 'systemPrompt']

export interface Config {
  baseUrl: string
  environmentId: string
  credentialRef: string
  runId?: string
  capabilityLease?: string
}

export const Config = z.object({
  baseUrl: z.string(),
  environmentId: z.string(),
  credentialRef: z.string(),
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
    expectedVersion: { type: 'integer' as const, required: true, description: 'Current AgentRun version.' },
    targetId: { type: 'string' as const, description: 'Optional target object id.' },
    expectedObjectVersion: { type: 'integer' as const, description: 'Optional optimistic object version.' },
    input: { type: 'json' as const, required: true, description: 'Action input object.' },
  },
  obis_get_task: {
    taskId: { type: 'string' as const, required: true, description: 'Governed OBIS task id.' },
  },
} as const

type ToolName = keyof typeof schemas

function toolContext(config: Config, exec: ToolRunContext): ObisToolContext {
  if (!exec.agent) throw new Error('OBIS tools require an active Harness Agent scope.')
  return {
    environmentId: config.environmentId,
    ...(config.runId ? { runId: config.runId } : {}),
    ...(config.capabilityLease ? { capabilityLease: config.capabilityLease } : {}),
    signal: exec.signal,
  }
}

function findDefinition(definitions: readonly ObisToolDefinition[], toolName: ToolName): ObisToolDefinition {
  const definition = definitions.find(candidate => candidate.name === toolName)
  if (!definition) throw new Error(`OBIS tool definition ${toolName} is unavailable.`)
  return definition
}

function normalizeConfig(config: Config): Config {
  const baseUrl = config.baseUrl.trim()
  const environmentId = config.environmentId.trim()
  const credentialReference = config.credentialRef.trim()
  if (!baseUrl) throw new TypeError('tool-obis baseUrl is required.')
  if (!environmentId) throw new TypeError('tool-obis environmentId is required.')
  if (!credentialReference) throw new TypeError('tool-obis credentialRef is required.')
  credentialRef(credentialReference)
  return {
    baseUrl,
    environmentId,
    credentialRef: credentialReference,
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

  for (const toolName of Object.keys(schemas) as ToolName[]) {
    const definition = findDefinition(definitions, toolName)
    ctx.tools.register(defineTool({
      name: toolName,
      description: definition.description,
      parameters: schemas[toolName],
      output,
      execute: async (args, exec) => await definition.execute(args as JsonRecord, toolContext(config, exec)) as JsonValue,
    }))
  }

  ctx.systemPrompt.section({
    name: 'tool:obis',
    order: 145,
    text: [
      'OBIS is the enterprise authority. Use obis_* tools for enterprise facts and governed operations.',
      'Never treat a proposed enterprise action as executed. Production mutation occurs only after OBIS policy, confirmation and approval gates complete.',
      'Use named governed queries for enterprise object reads; do not infer missing enterprise facts from local files or model memory.',
    ].join('\n'),
  })
}
