/** Cordis lifecycle ownership for the stdio carrier plugin. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

const close = vi.fn(async () => {})
const serveStdioFetch = vi.fn(() => ({ close, done: Promise.resolve() }))

vi.mock('../src/fetch/stdio.ts', () => ({ serveStdioFetch }))

describe('stdio carrier plugin', () => {
  beforeEach(() => {
    close.mockClear()
    serveStdioFetch.mockClear()
  })

  it('binds process streams to ApiProxy for the plugin fiber lifetime', async () => {
    const { apply, inject, name } = await import('../src/stdio-plugin.ts')
    let dispose: (() => Promise<void>) | undefined
    const ctx = {
      apiProxy: {},
      effect(factory: () => () => Promise<void>) { dispose = factory() },
    } as unknown as Context

    apply(ctx)
    expect(name).toBe('host-apiproxy-stdio')
    expect(inject).toEqual(['apiProxy'])
    expect(serveStdioFetch).toHaveBeenCalledWith(expect.objectContaining({
      input: process.stdin,
      output: process.stdout,
    }))
    await dispose?.()
    expect(close).toHaveBeenCalledOnce()
  })
})
