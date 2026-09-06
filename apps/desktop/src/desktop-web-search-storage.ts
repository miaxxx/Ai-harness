/** Versioned parsing for the encrypted You.com key stored by Electron Main. */

/** Current Desktop web-search settings format. */
export const WEB_SEARCH_SETTINGS_VERSION = 1

/** Private Desktop record for the You.com credential. */
export interface StoredWebSearchSettings {
  version: typeof WEB_SEARCH_SETTINGS_VERSION
  encryptedApiKey: string
}

/**
 * Parse one private web-search record without decrypting its credential.
 * @param value - Untrusted JSON value read from the Electron user-data directory.
 * @returns validated encrypted-key record.
 */
export function parseStoredWebSearchSettings(value: unknown): StoredWebSearchSettings {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop web search settings are malformed')
  const row = value as Partial<StoredWebSearchSettings>
  if (row.version !== WEB_SEARCH_SETTINGS_VERSION || typeof row.encryptedApiKey !== 'string' || row.encryptedApiKey === '') {
    throw new Error('Desktop web search settings are malformed')
  }
  return row as StoredWebSearchSettings
}
