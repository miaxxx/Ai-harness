import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerRuntime from '@deepseek-ai/dsh-computer'
import type { ComputerProvider } from '@deepseek-ai/dsh-computer'

function provider(id: string, available = true): ComputerProvider {
  return {
    id,
    available: () => available,
    listApps: () => Promise.resolve([{ id: 'app', name: id }]),
    inspect: app => Promise.resolve({ app: { id: app, name: id }, text: '', elements: [] }),
    act: app => Promise.resolve({ app: { id: app, name: id }, text: '', elements: [] }),
  }
}

async function mount(config: ConstructorParameters<typeof ComputerRuntime>[1] = {}): Promise<ComputerRuntime> {
  const ctx = new Context()
  await ctx.plugin(ComputerRuntime, config)
  return ctx.computer
}

describe('ComputerRuntime provider selection', () => {
  it('uses the only usable Provider', async () => {
    const computer = await mount()
    computer.register(provider('one'))
    await expect(computer.listApps()).resolves.toEqual([{ id: 'app', name: 'one' }])
  })

  it('does not choose by registration order when Provider selection is ambiguous', async () => {
    const computer = await mount()
    computer.register(provider('one'))
    computer.register(provider('two'))
    expect(() => computer.listApps()).toThrow('No usable local computer provider is configured.')
  })

  it('uses the explicitly configured Provider', async () => {
    const computer = await mount({ provider: 'two' })
    computer.register(provider('one'))
    computer.register(provider('two'))
    await expect(computer.listApps()).resolves.toEqual([{ id: 'app', name: 'two' }])
  })

  it('removes a disposed registration', async () => {
    const computer = await mount()
    const dispose = computer.register(provider('one'))
    dispose()
    expect(() => computer.listApps()).toThrow('No usable local computer provider is configured.')
  })

  it('rejects duplicate Provider ids and unavailable configured Providers', async () => {
    const computer = await mount({ provider: 'one' })
    computer.register(provider('one', false))
    expect(() => computer.register(provider('one'))).toThrow('already registered')
    expect(() => computer.listApps()).toThrow('No usable local computer provider is configured.')
  })

  it('forwards inspect and action inputs to the selected Provider', async () => {
    const computer = await mount()
    const signal = new AbortController().signal
    const selected = provider('one')
    computer.register(selected)
    await expect(computer.inspect('app', true, signal)).resolves.toMatchObject({ app: { name: 'one' } })
    await expect(computer.act('app', { kind: 'key', key: 'Return' }, signal)).resolves.toMatchObject({ app: { name: 'one' } })
  })
})
