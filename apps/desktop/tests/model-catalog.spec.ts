import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverDesktopModels, parseDesktopModelCatalog } from '../src/models/main/catalog.ts'

afterEach(() => vi.unstubAllGlobals())
const request = { baseURL: 'https://example.test/v1/', apiKey: 'private-key', configuredModel: 'current' }

describe('Desktop model directory', () => {
  it.each([['one'], ['one', 'two', 'three']])('detects a directory with %j', async (...ids) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: ids.map(id => ({ id })) })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await discoverDesktopModels(request)).toEqual({ source: 'endpoint', models: ids.map(id => ({ id, name: id })) })
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/v1/models', expect.objectContaining({ redirect: 'error', headers: { authorization: 'Bearer private-key', accept: 'application/json' } }))
  })

  it('deduplicates ids and uses provider names', () => {
    expect(parseDesktopModelCatalog({ data: [{ id: 'one' }, { id: 'one', display_name: 'Model One' }] })).toEqual([{ id: 'one', name: 'Model One' }])
  })

  it.each([{}, { data: [null] }, { data: [{ id: '' }] }, { data: Array.from({ length: 1001 }, () => ({ id: 'one' })) }])('rejects malformed or oversized directories', (value) => {
    expect(() => parseDesktopModelCatalog(value)).toThrow()
  })

  it.each([new Response('secret server details', { status: 403 }), new Response('{bad'), new Response(JSON.stringify({ data: [] })), new Response('x'.repeat(1024 * 1024 + 1))])('preserves the current model when listing is unavailable', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const result = await discoverDesktopModels(request)
    expect(result).toMatchObject({ source: 'configured', models: [{ id: 'current', name: 'current' }] })
    expect(result.warning).toBeTruthy()
    expect(result.warning).not.toContain('secret')
  })
})
