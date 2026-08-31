import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerRuntime from '@deepseek-ai/dsh-computer'
import type { ComputerProvider, ComputerTargetKind } from '@deepseek-ai/dsh-computer'

function provider(id: string, targetKinds: readonly ComputerTargetKind[], available = true): ComputerProvider {
  return {
    id, targetKinds, available: () => available,
    listTargets: () => Promise.resolve(targetKinds.map(kind => kind === 'desktop'
      ? { kind: 'desktop' as const, id: 'desktop' as const, name: 'Desktop' as const }
      : { kind, id: `${kind}-id`, name: id })),
    observe: target => Promise.resolve({ id: `${id}-observation`, target, accessibility: { text: id, elements: [] } }),
    perform: target => Promise.resolve({ id: `${id}-after`, target, accessibility: { text: `${id}-after`, elements: [] } }),
  }
}
async function mount(config: ConstructorParameters<typeof ComputerRuntime>[1] = {}): Promise<ComputerRuntime> {
  const ctx = new Context()
  await ctx.plugin(ComputerRuntime, config)
  return ctx.computer
}

describe('ComputerRuntime target-aware routing', () => {
  it('combines target discovery across providers without choosing one globally', async () => {
    const computer = await mount()
    computer.register(provider('native', ['app', 'desktop']))
    computer.register(provider('browser', ['browser-tab']))
    await expect(computer.listTargets()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'app', name: 'native' }),
      expect.objectContaining({ kind: 'desktop' }),
      expect.objectContaining({ kind: 'browser-tab', name: 'browser' }),
    ]))
  })

  it('routes app and browser targets to different providers in one runtime', async () => {
    const computer = await mount()
    computer.register(provider('native', ['app']))
    computer.register(provider('browser', ['browser-tab']))
    await expect(computer.observe({ kind: 'app', id: 'Editor', name: 'Editor' })).resolves.toMatchObject({ accessibility: { text: 'native' } })
    await expect(computer.observe({ kind: 'browser-tab', id: 'tab', name: 'Tab' })).resolves.toMatchObject({ accessibility: { text: 'browser' } })
  })

  it('uses the configured provider only as a same-kind ambiguity tie-breaker', async () => {
    const computer = await mount({ provider: 'two' })
    computer.register(provider('one', ['app']))
    computer.register(provider('two', ['app']))
    computer.register(provider('browser', ['browser-tab']))
    await expect(computer.observe({ kind: 'app', id: 'Editor', name: 'Editor' })).resolves.toMatchObject({ accessibility: { text: 'two' } })
    await expect(computer.observe({ kind: 'browser-tab', id: 'tab', name: 'Tab' })).resolves.toMatchObject({ accessibility: { text: 'browser' } })
  })

  it('rejects ambiguous and unsupported target kinds instead of registration-order routing', async () => {
    const computer = await mount()
    computer.register(provider('one', ['app']))
    computer.register(provider('two', ['app']))
    expect(() => computer.observe({ kind: 'app', id: 'Editor', name: 'Editor' })).toThrow('ACTION_UNSUPPORTED')
    expect(() => computer.observe({ kind: 'desktop', id: 'desktop', name: 'Desktop' })).toThrow('ACTION_UNSUPPORTED')
  })

  it('filters discovery by target kind and ignores unavailable providers', async () => {
    const computer = await mount()
    computer.register(provider('native', ['app'], false))
    computer.register(provider('browser', ['browser-tab']))
    await expect(computer.listTargets('browser-tab')).resolves.toHaveLength(1)
    await expect(computer.listTargets('app')).resolves.toEqual([])
  })

  it('removes disposed providers and rejects duplicate ids', async () => {
    const computer = await mount()
    const dispose = computer.register(provider('one', ['app']))
    expect(() => computer.register(provider('one', ['desktop']))).toThrow('already registered')
    dispose()
    await expect(computer.listTargets()).resolves.toEqual([])
  })

  it('forwards cancellation and returns fresh post-action provider state', async () => {
    const computer = await mount()
    const selected = provider('one', ['app'])
    computer.register(selected)
    const signal = new AbortController().signal
    await expect(computer.perform({ kind: 'app', id: 'Editor', name: 'Editor' }, { kind: 'key', key: 'Return', modifiers: [] }, signal))
      .resolves.toMatchObject({ id: 'one-after', accessibility: { text: 'one-after' } })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    expect(() => computer.observe({ kind: 'app', id: 'Editor', name: 'Editor' }, 'accessibility', controller.signal)).toThrow('cancelled')
  })
})
