import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as DeliveryQualityPolicy from '@deepseek-ai/dsh-delivery-quality-policy'

describe('delivery quality policy', () => {
  it('registers outcome-proportional completion evidence as one stable prompt section', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    const fiber = await ctx.plugin(DeliveryQualityPolicy)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections).toContainEqual({
      name: DeliveryQualityPolicy.DELIVERY_QUALITY_SECTION,
      text: DeliveryQualityPolicy.DELIVERY_QUALITY_PROMPT,
    })
    const prompt = renderPrompt(assembly)
    expect(prompt).toContain('If the current state already satisfies the request, stop without making unnecessary changes')
    expect(prompt).toContain('For read-only questions or research')
    expect(prompt).toContain('For code or file mutations')
    expect(prompt).toContain('For external or GUI mutations')
    expect(prompt).toContain('For produced or edited artifacts')
    expect(prompt).toContain('A successful action call by itself is not evidence')
    expect(prompt).toContain('repair it and rerun the affected checks')

    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble()).sections)
      .not.toContainEqual(expect.objectContaining({ name: DeliveryQualityPolicy.DELIVERY_QUALITY_SECTION }))
  })
})
