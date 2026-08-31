import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as DeliveryQualityPolicy from '@deepseek-ai/dsh-delivery-quality-policy'

describe('delivery quality policy', () => {
  it('registers the complete acceptance loop as one stable prompt section', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    const fiber = await ctx.plugin(DeliveryQualityPolicy)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections).toContainEqual({
      name: DeliveryQualityPolicy.DELIVERY_QUALITY_SECTION,
      text: DeliveryQualityPolicy.DELIVERY_QUALITY_PROMPT,
    })
    expect(renderPrompt(assembly)).toContain('Run the checks against the final state after the last meaningful change')
    expect(renderPrompt(assembly)).toContain('repair it and rerun the affected checks')

    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble()).sections)
      .not.toContainEqual(expect.objectContaining({ name: DeliveryQualityPolicy.DELIVERY_QUALITY_SECTION }))
  })
})
