import type { ObisBridgeClient, RequestOptions } from './client.ts'
import type { AgentRunBinding } from './types.ts'

export interface ObisRunBindingInput {
  environmentId: string
  agentId: string
  goal: string
  autonomy?: string
  harnessSessionId: string
  installationId?: string
}

/**
 * Bind one Harness session to one OBIS-governed AgentRun. The Harness session remains
 * Harness-owned; only its opaque identifier is attached to enterprise trace metadata.
 */
export async function bindObisRun(client: ObisBridgeClient, input: ObisRunBindingInput, options: RequestOptions): Promise<AgentRunBinding> {
  const runKey = options.idempotencyKey ?? `harness-session:${input.harnessSessionId}`
  const run = await client.createAgentRun({
    environmentId: input.environmentId,
    agentId: input.agentId,
    goal: input.goal,
    ...(input.autonomy ? { autonomy: input.autonomy } : {}),
  }, { ...options, idempotencyKey: runKey })
  return client.attachAgentRun(run.id, {
    environmentId: input.environmentId,
    harnessSessionId: input.harnessSessionId,
    ...(input.installationId ? { installationId: input.installationId } : {}),
  }, { ...options, idempotencyKey: `${runKey}:attach` })
}
