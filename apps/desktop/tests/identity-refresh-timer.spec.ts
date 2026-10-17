import { afterEach, expect, it, vi } from 'vitest'
import { DesktopIdentityRefreshTimer } from '../src/desktop-identity-refresh-timer.ts'

afterEach(() => { vi.useRealTimers() })

it('renews before expiry without a renderer request and retries an offline attempt', async () => {
  vi.useFakeTimers()
  const renew = vi.fn<() => Promise<string | undefined>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(async () => new Date(Date.now() + 900_000).toISOString())
  const timer = new DesktopIdentityRefreshTimer(30_000, 10_000, renew)
  timer.schedule(new Date(Date.now() + 900_000).toISOString())
  await vi.advanceTimersByTimeAsync(869_999)
  expect(renew).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(renew).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(renew).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(870_000)
  expect(renew).toHaveBeenCalledTimes(3)
  timer.stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('logout or shutdown cancels renewal even while a request is pending', async () => {
  vi.useFakeTimers()
  let finish!: (value: string) => void
  const renew = vi.fn(() => new Promise<string>((resolve) => { finish = resolve }))
  const timer = new DesktopIdentityRefreshTimer(30_000, 10_000, renew)
  timer.schedule(new Date(Date.now() + 30_001).toISOString())
  await vi.advanceTimersByTimeAsync(1)
  timer.stop()
  finish(new Date(Date.now() + 900_000).toISOString())
  await vi.advanceTimersByTimeAsync(900_000)
  expect(renew).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('replaces a deadline and rejects invalid timing', async () => {
  vi.useFakeTimers()
  const renew = vi.fn(async () => undefined)
  const timer = new DesktopIdentityRefreshTimer(30_000, 10_000, renew)
  timer.schedule(new Date(Date.now() + 30_001).toISOString())
  timer.schedule(undefined)
  await vi.advanceTimersByTimeAsync(1)
  expect(renew).not.toHaveBeenCalled()
  expect(() => { timer.schedule('invalid') }).toThrow('timestamp')
  expect(() => new DesktopIdentityRefreshTimer(0, 1, renew)).toThrow('positive integer')
  timer.stop()
})
