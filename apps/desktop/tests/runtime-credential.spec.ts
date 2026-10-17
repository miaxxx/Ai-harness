import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopRuntimeCredentialLifetime, desktopRuntimeCredentialExpiry } from '../src/desktop-runtime-credential.ts'

afterEach(() => vi.useRealTimers())

describe('native runtime delegation lifetime', () => {
  it('renews before the source human session rotates even when the delegated token expires later', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const lifetime = new DesktopRuntimeCredentialLifetime()
    const expiry = desktopRuntimeCredentialExpiry(new Date(1_200_000).toISOString(), new Date(900_000).toISOString(), 30_000)
    expect(Date.parse(expiry)).toBe(870_000)
    lifetime.setExpiry(expiry)
    const renew = vi.fn(async () => { lifetime.setExpiry(new Date(1_700_000).toISOString()) })
    vi.setSystemTime(869_999)
    await lifetime.run(renew, async () => 'before')
    expect(renew).not.toHaveBeenCalled()
    vi.setSystemTime(870_000)
    expect(await lifetime.run(renew, async () => 'after')).toBe('after')
    expect(renew).toHaveBeenCalledOnce()
    expect(desktopRuntimeCredentialExpiry(new Date(100).toISOString(), undefined, 30)).toBe(new Date(100).toISOString())
    expect(desktopRuntimeCredentialExpiry(new Date(100).toISOString(), new Date(500).toISOString(), 30)).toBe(new Date(100).toISOString())
    expect(() => desktopRuntimeCredentialExpiry('invalid', undefined, 30)).toThrow('有效期无效')
    expect(() => desktopRuntimeCredentialExpiry(new Date(100).toISOString(), 'invalid', 30)).toThrow('有效期无效')
  })

  it('leaves valid and undelegated runtime prompts unchanged', async () => {
    const lifetime = new DesktopRuntimeCredentialLifetime(), renew = vi.fn()
    expect(await lifetime.run(renew, async () => 'local')).toBe('local')
    lifetime.setExpiry(new Date(Date.now() + 60_000).toISOString())
    expect(await lifetime.run(renew, async () => 'governed')).toBe('governed')
    expect(renew).not.toHaveBeenCalled()
    expect(() => { lifetime.setExpiry('invalid') }).toThrow('有效期无效')
  })

  it('shares idle credential renewal and restores readiness before concurrent prompts', async () => {
    const lifetime = new DesktopRuntimeCredentialLifetime()
    lifetime.setExpiry(new Date(Date.now() - 1).toISOString())
    let finish!: () => void
    const renew = vi.fn(async () => {
      await new Promise<void>((resolve) => { finish = resolve })
      lifetime.setExpiry(new Date(Date.now() + 60_000).toISOString())
    })
    const first = lifetime.run(renew, async () => 'one')
    const second = lifetime.run(renew, async () => 'two')
    await Promise.resolve()
    expect(renew).toHaveBeenCalledTimes(1)
    finish()
    expect(await Promise.all([first, second])).toEqual(['one', 'two'])
  })

  it('does not interrupt an active reply when its delegation expires', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const lifetime = new DesktopRuntimeCredentialLifetime(), renew = vi.fn()
    lifetime.setExpiry(new Date(2000).toISOString())
    let finish!: () => void
    const active = lifetime.run(renew, () => new Promise<void>((resolve) => { finish = resolve }))
    vi.setSystemTime(2000)
    await expect(lifetime.run(renew, async () => 'new')).rejects.toThrow('等待当前回复')
    expect(renew).not.toHaveBeenCalled()
    finish(); await active
  })

  it('propagates renewal failure, refuses stale renewal and never retries a sent operation', async () => {
    const lifetime = new DesktopRuntimeCredentialLifetime(), operation = vi.fn(async () => 'sent')
    lifetime.setExpiry(new Date(Date.now() - 1).toISOString())
    const refused = new Error('source session revoked')
    await expect(lifetime.run(async () => { throw refused }, operation)).rejects.toBe(refused)
    await expect(lifetime.run(async () => {}, operation)).rejects.toThrow('续期未完成')
    expect(operation).not.toHaveBeenCalled()
    const sentError = new Error('server denied Action')
    lifetime.setExpiry(undefined)
    const failedOperation = vi.fn(async () => { throw sentError })
    await expect(lifetime.run(async () => {}, failedOperation)).rejects.toBe(sentError)
    expect(failedOperation).toHaveBeenCalledTimes(1)
  })
})
