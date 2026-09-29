import type { ObisBridgeClient, RequestOptions } from './client.ts'
import type { AgentRunBinding } from './types.ts'

/** Session, goal, and optional published module ids used to create and attach one AgentRun. */
export interface ObisRunBindingInput {
  environmentId: string
  agentId: string
  goal: string
  autonomy?: string
  harnessSessionId: string
  installationId?: string
  projectId?: string
  applicationModuleId?: string
}

/**
 * Bind one Harness session to one OBIS-governed AgentRun. The Harness session remains
 * Harness-owned; only its opaque identifier is attached to enterprise trace metadata.
 * Optional projectId and applicationModuleId stamp a published module snapshot onto the run.
 * @param client OHP bridge client used to create and attach the run
 * @param input session, goal, autonomy, and optional published module ids
 * @param options idempotency, lease, and cancellation headers
 * @returns the attached AgentRun binding
 */
export async function bindObisRun(client: ObisBridgeClient, input: ObisRunBindingInput, options: RequestOptions): Promise<AgentRunBinding> {
  const runKey = options.idempotencyKey ?? `harness-session:${input.harnessSessionId}`
  const projectId = input.projectId?.trim()
  const applicationModuleId = input.applicationModuleId?.trim()
  if ((projectId && !applicationModuleId) || (!projectId && applicationModuleId)) {
    throw new TypeError('projectId and applicationModuleId must be supplied together.')
  }
  const run = await client.createAgentRun({
    environmentId: input.environmentId,
    agentId: input.agentId,
    goal: input.goal,
    ...(input.autonomy ? { autonomy: input.autonomy } : {}),
    ...(projectId && applicationModuleId ? { projectId, applicationModuleId } : {}),
  }, { ...options, idempotencyKey: runKey })
  return client.attachAgentRun(run.id, {
    environmentId: input.environmentId,
    harnessSessionId: input.harnessSessionId,
    ...(input.installationId ? { installationId: input.installationId } : {}),
  }, { ...options, idempotencyKey: `${runKey}:attach` })
}
