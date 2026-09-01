import { describe, expect, it } from 'vitest'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { renderGoalRoundPrompt } from '../src/index.ts'

describe('goal-round outcome evidence regression', () => {
  it('keeps completion tied to fresh final-state evidence without adding another completion framework', () => {
    const goal: GoalView = {
      id: GoalId('goal-outcome-evidence'),
      revision: 1,
      objective: 'Finish and verify the requested outcome',
      phase: 'active',
      maxGoalRounds: 4,
      roundsStarted: 1,
      createdAt: 1,
      updatedAt: 1,
      activation: 'armed',
    }

    const block = renderGoalRoundPrompt(goal, 2)[0]
    if (block?.type !== 'text') throw new Error('expected a text goal-round prompt')

    expect(block.text).toContain('tool results, and durable session state as authoritative')
    expect(block.text).toContain('Run final checks after the last meaningful change')
    expect(block.text).toContain('if a check fails, repair the defect and re-check it')
    expect(block.text).toContain('gather current evidence that the whole objective is achieved')
    expect(block.text).toContain('mark it complete')
  })
})
