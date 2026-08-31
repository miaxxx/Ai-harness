/**
 * Global final-state acceptance policy for agent deliverables.
 * @module @deepseek-ai/dsh-delivery-quality-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'delivery-quality-policy'

/** The prompt registry this policy contributes to. */
export const inject = ['systemPrompt']

/** Stable system-prompt section name. */
export const DELIVERY_QUALITY_SECTION = 'policy:delivery-quality'

/** Stable ordering after tool policy sections and before ordinary task context. */
export const DELIVERY_QUALITY_ORDER = 120

/** Complete model-facing acceptance policy. */
export const DELIVERY_QUALITY_PROMPT = `Before claiming a task complete, validate every requested deliverable against the user's request and applicable project instructions. For work that creates or changes an artifact, treat final acceptance as mandatory. When the session skill catalog provides \`delivery-verification\`, load and follow it for that acceptance pass.

Derive concrete checks from the requested outcome, constraints, and output format. Run the checks against the final state after the last meaningful change; an earlier passing result or mere file existence is not current evidence. Use deterministic checks where available. Render or open visual artifacts and inspect the actual output, including every page, slide, sheet, requested UI state, or generated image that can affect acceptance.

If a check exposes a defect, repair it and rerun the affected checks. Continue this inspect, fix, and re-check loop until the deliverables pass or a concrete external blocker prevents further progress. Do not lower the acceptance criteria to finish. In the final response, name the deliverables and the verification actually performed; never imply an unavailable or unrun check passed.`

/**
 * Register the global delivery-quality prompt section.
 * @param ctx - Cordis context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: DELIVERY_QUALITY_SECTION,
    order: DELIVERY_QUALITY_ORDER,
    text: DELIVERY_QUALITY_PROMPT,
  }), 'deliveryQualityPolicy.section()')
}
