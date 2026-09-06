import { describe, expect, it } from 'vitest'
import { WEB_SEARCH_SETTINGS_VERSION, parseStoredWebSearchSettings } from '../src/desktop-web-search-storage.ts'

describe('Desktop web-search settings storage', () => {
  it('accepts a versioned encrypted-key record without exposing a plaintext field', () => {
    const stored = { version: WEB_SEARCH_SETTINGS_VERSION, encryptedApiKey: 'encrypted' }
    expect(parseStoredWebSearchSettings(stored)).toEqual(stored)
  })

  it.each([
    null,
    {},
    { version: WEB_SEARCH_SETTINGS_VERSION },
    { version: WEB_SEARCH_SETTINGS_VERSION, encryptedApiKey: '' },
    { version: WEB_SEARCH_SETTINGS_VERSION, encryptedApiKey: 1 },
    { version: WEB_SEARCH_SETTINGS_VERSION + 1, encryptedApiKey: 'encrypted' },
  ])('rejects malformed settings: %j', (value) => {
    expect(() => parseStoredWebSearchSettings(value)).toThrow('Desktop web search settings are malformed')
  })
})
