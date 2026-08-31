/** Versioned parsing for Desktop primary-model settings stored by Electron Main. */

import type { DesktopModelProtocol } from './shared.ts'

/** Current Desktop primary-model settings format. */
export const MODEL_SETTINGS_VERSION = 2

/** Primary-model settings retained in the privileged Electron user-data directory. */
export interface StoredModelSettings {
  version: typeof MODEL_SETTINGS_VERSION
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  encryptedApiKey: string
  computerUseEnabled: boolean
}

const MODEL_PROTOCOLS: readonly DesktopModelProtocol[] = ['openai-completions', 'openai-responses']

/**
 * Parse current settings and upgrade the version-1 record that predates Computer Use.
 * @param value - Untrusted JSON value read from the settings file.
 * @returns Current in-memory settings without exposing or rewriting the encrypted key.
 */
export function parseStoredModelSettings(value: unknown): StoredModelSettings {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop model settings are malformed')
  const row = value as Partial<Record<keyof StoredModelSettings, unknown>>
  const commonFieldsValid = (
    typeof row.baseURL === 'string'
    && typeof row.model === 'string'
    && MODEL_PROTOCOLS.includes(row.protocol as DesktopModelProtocol)
    && typeof row.encryptedApiKey === 'string'
  )
  if (!commonFieldsValid) throw new Error('Desktop model settings are malformed')
  if (row.version === 1) {
    return {
      version: MODEL_SETTINGS_VERSION,
      baseURL: row.baseURL as string,
      model: row.model as string,
      protocol: row.protocol as DesktopModelProtocol,
      encryptedApiKey: row.encryptedApiKey as string,
      computerUseEnabled: false,
    }
  }
  if (row.version !== MODEL_SETTINGS_VERSION || typeof row.computerUseEnabled !== 'boolean') {
    throw new Error('Desktop model settings are malformed')
  }
  return row as unknown as StoredModelSettings
}
