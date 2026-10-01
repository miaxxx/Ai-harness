// @vitest-environment jsdom
/** Composer display metadata is warmed independently of authoritative execution. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApplicationNavigationRecord } from '../src/desktop-application-shared.ts'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('business reference menu cache', () => {
  it('shows the validated directory without waiting for refresh and incorporates later publication', async () => {
    let finish!: (pages: DesktopApplicationNavigationRecord[]) => void
    const navigation = vi.fn(() => new Promise<DesktopApplicationNavigationRecord[]>((resolve) => { finish = resolve }))
    vi.stubGlobal('window', { dshApplications: { navigation }, dshEnterprise: { status: vi.fn(() => { throw new Error('identity is already validated') }) } })
    const { seedBusinessReferenceCatalog, desktopBusinessReferenceSource } = await import('../src/desktop-business-references.ts')
    seedBusinessReferenceCatalog({ projectId: 'p', environmentId: 'test' }, [
      { id: 'supplier-home', label: '供应商', page: 'home', moduleId: 'supplier', moduleVersion: '1' },
    ])
    const source = desktopBusinessReferenceSource()
    const session = {} as Parameters<InputTriggerSource['candidates']>[0]
    const request = { query: '', position: 'leading' as const, signal: new AbortController().signal }
    const first = await source.candidates(session, request)
    expect(first.some(row => row.name === '供应商')).toBe(true)
    await source.candidates(session, request)
    expect(navigation).toHaveBeenCalledTimes(1)
    finish([{ id: 'orders-home', label: '订单', page: 'home', moduleId: 'orders', moduleVersion: '2' }])
    await Promise.resolve(); await Promise.resolve()
    const next = await source.candidates(session, request)
    expect(next.some(row => row.name === '供应商')).toBe(false)
    expect(next.some(row => row.name === '订单')).toBe(true)
    const aborted = new AbortController(); aborted.abort()
    expect(await source.candidates(session, { query: '', position: 'leading', signal: aborted.signal })).toEqual([])
  })
})
