import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('obis-launch invariant companion', () => {
  it('registers an empty installer against the launch package name', async () => {
    expect(name).toBe('obis-launch-invariant')
    expect(inject).toEqual(['invariants'])
    const register = vi.fn((_: string, install: () => void) => {
      install()
      return () => {}
    })
    const dispose = await apply({ invariants: { register } } as never)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-obis-launch', expect.any(Function))
    dispose()
  })
})
