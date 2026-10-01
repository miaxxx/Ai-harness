/** Bounded SSE reads retain the AgentRun lease in the Harness Host. */
import type { ObisBridgeClient, ObisToolDefinition } from '@deepseek-ai/dsh-obis-bridge'

/**
 * Create a read tool that returns the next public Kernel event, then closes SSE.
 * @param client Governed bridge whose credential provider remains Host-owned.
 * @param timeoutMs Deployment-configured maximum wait for one event.
 * @returns Read-only definition; caller cancellation and server refusal remain errors.
 */
export function createRunEventTool(client: ObisBridgeClient, timeoutMs: number): ObisToolDefinition {
  return {
    name: 'obis_next_run_event',
    description: 'Read the next public event of this bound OBIS AgentRun over authenticated SSE. Supply afterId to resume; a wait timeout returns no event. This does not complete a task or execute an Action.',
    mutating: false,
    execute: async (input, context) => {
      if (!context.runId || !context.capabilityLease) throw new TypeError('OBIS run events require a bound AgentRun and Host lease.')
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, timeoutMs)
      const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal
      try {
        for await (const event of client.streamAgentRunEvents(context.runId, context.environmentId, {
          signal, agentRunId: context.runId, capabilityLease: context.capabilityLease,
          ...(typeof input.afterId === 'string' ? { afterId: input.afterId } : {}),
        })) return { runId: context.runId, event, timedOut: false }
        return { runId: context.runId, event: null, timedOut: false }
      } catch (error) {
        if (context.signal?.aborted) throw error
        if (controller.signal.aborted && error === controller.signal.reason) return { runId: context.runId, event: null, timedOut: true }
        throw error
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
    },
  }
}
