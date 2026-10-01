import type { ObisBridgeClient, RequestOptions } from './client.ts'
import type { JsonRecord } from './types.ts'

/** Authenticated environment and Host-held run authority for a model-facing read or proposal. */
export interface ObisToolContext {
  environmentId: string
  runId?: string
  capabilityLease?: string
  signal?: AbortSignal
  idempotencyKey?: string
}

/** Model-facing operation adapted by the native Harness tool plugin. */
export interface ObisToolDefinition<TInput extends JsonRecord = JsonRecord> {
  name: string
  description: string
  mutating: boolean
  execute(input: TInput, context: ObisToolContext): Promise<unknown>
}

function governedOptions(context: ObisToolContext, extra: RequestOptions = {}): RequestOptions {
  return {
    ...extra,
    ...(context.runId ? { agentRunId: context.runId } : {}),
    ...(context.capabilityLease ? { capabilityLease: context.capabilityLease } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
  }
}

/**
 * Protocol-neutral model-facing capabilities. The Harness tool plugin adapts these
 * definitions into the native tool schema without coupling this package to AgentLoop.
 * @param client OHP bridge client used for every governed call.
 * @returns Model-facing tool definitions bound to `client`.
 */
export function createObisTools(client: ObisBridgeClient): ObisToolDefinition[] {
  return [
    {
      name: 'obis_context',
      description: 'Resolve bounded, deployment-pinned enterprise context for the authenticated OBIS user.',
      mutating: false,
      execute: (input, context) => client.resolveContext(context.environmentId, {
        ...(input.focus && typeof input.focus === 'object' && !Array.isArray(input.focus) ? { focus: input.focus as JsonRecord } : {}),
        ...(typeof input.maxSymbols === 'number' ? { maxSymbols: input.maxSymbols } : {}),
      }, governedOptions(context)),
    },
    {
      name: 'obis_query',
      description: 'Execute a named governed OBIS query. Policy, row filtering and projection are enforced by OBIS.',
      mutating: false,
      execute: (input, context) => {
        if (typeof input.query !== 'string') throw new TypeError('obis_query requires query.')
        return client.executeQuery(context.environmentId, input.query, {
          ...(typeof input.id === 'string' ? { id: input.id } : {}),
          ...(input.where && typeof input.where === 'object' && !Array.isArray(input.where) ? { where: input.where as JsonRecord } : {}),
          ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        }, governedOptions(context))
      },
    },
    {
      name: 'obis_get_object',
      description: 'Read one enterprise object through a named governed query. This never bypasses OBIS query policy or projection.',
      mutating: false,
      execute: (input, context) => {
        if (typeof input.query !== 'string' || typeof input.id !== 'string') {
          throw new TypeError('obis_get_object requires query and id.')
        }
        return client.executeQuery(context.environmentId, input.query, { id: input.id, limit: 1 }, governedOptions(context))
      },
    },
    {
      name: 'obis_search_knowledge',
      description: 'Search enterprise knowledge visible to the authenticated user. OBIS enforces document ACLs.',
      mutating: false,
      execute: (input, context) => {
        if (typeof input.query !== 'string') throw new TypeError('obis_search_knowledge requires query.')
        return client.searchKnowledge(
          context.environmentId,
          input.query,
          typeof input.limit === 'number' ? input.limit : 20,
          governedOptions(context),
        )
      },
    },
    {
      name: 'obis_propose_action',
      description: 'Create a governed enterprise action proposal. This does not directly execute the production mutation.',
      mutating: true,
      execute: async (input, context) => {
        if (!context.runId) throw new TypeError('obis_propose_action requires an AgentRun binding.')
        if (typeof input.action !== 'string') throw new TypeError('obis_propose_action requires action.')
        const actionInput = input.input
        if (!actionInput || typeof actionInput !== 'object' || Array.isArray(actionInput)) throw new TypeError('obis_propose_action input must be an object.')
        const expectedVersion = typeof input.expectedVersion === 'number'
          ? input.expectedVersion
          : (await client.getAgentRun(context.runId, context.environmentId, governedOptions(context))).version
        return client.proposeAction(input.action, {
          environmentId: context.environmentId,
          runId: context.runId,
          expectedVersion,
          ...(typeof input.targetId === 'string' ? { targetId: input.targetId } : {}),
          ...(typeof input.expectedObjectVersion === 'number' ? { expectedObjectVersion: input.expectedObjectVersion } : {}),
          input: actionInput as JsonRecord,
        }, governedOptions(context, {
          idempotencyKey: context.idempotencyKey ?? `${context.runId}:${input.action}:${expectedVersion}`,
        }))
      },
    },
    {
      name: 'obis_list_tasks',
      description: 'List governed OBIS tasks visible to the authenticated user.',
      mutating: false,
      execute: (input, context) => client.listTasks(context.environmentId, {
        ...(typeof input.status === 'string' ? { status: input.status } : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
      }, governedOptions(context)),
    },
    {
      name: 'obis_get_task',
      description: 'Read the current governed OBIS task state associated with work.',
      mutating: false,
      execute: (input, context) => {
        if (typeof input.taskId !== 'string') throw new TypeError('obis_get_task requires taskId.')
        return client.getTask(input.taskId, context.environmentId, governedOptions(context))
      },
    },
    {
      name: 'obis_list_approvals',
      description: 'List business-approval inbox items visible to the authenticated user. This does not decide an approval.',
      mutating: false,
      execute: (input, context) => client.listApprovals(context.environmentId, {
        ...(typeof input.status === 'string' ? { status: input.status } : {}),
      }, governedOptions(context)),
    },
    {
      name: 'obis_list_skills',
      description: 'List Kernel IR skill definitions visible for the current deployment. This does not start a skill-runtime sandbox.',
      mutating: false,
      execute: (_input, context) => client.listSkills(context.environmentId, governedOptions(context)),
    },
    {
      name: 'obis_get_skill',
      description: 'Load a deployment-pinned governed OBIS skill definition visible to the authenticated user. This does not start a skill-runtime sandbox.',
      mutating: false,
      execute: (input, context) => {
        if (typeof input.skillId !== 'string') throw new TypeError('obis_get_skill requires skillId.')
        return client.getSkill(input.skillId, context.environmentId, governedOptions(context))
      },
    },
  ]
}
