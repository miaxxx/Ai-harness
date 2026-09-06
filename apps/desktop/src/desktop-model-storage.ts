/** Versioned parsing for Desktop primary-model settings stored by Electron Main. */

import type { DesktopModelCapabilities, DesktopModelProtocol } from './shared.ts'

/** Current Desktop primary-model settings format. */
export const MODEL_SETTINGS_VERSION = 3

/** Primary-model settings retained in the privileged Electron user-data directory. */
export interface StoredModelSettings {
  version: typeof MODEL_SETTINGS_VERSION
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  encryptedApiKey: string
  computerUseEnabled: boolean
  capabilities: DesktopModelCapabilities
}

const MODEL_PROTOCOLS: readonly DesktopModelProtocol[] = ['openai-completions', 'openai-responses']

const UNVERIFIED_CAPABILITIES: DesktopModelCapabilities = {
  input: ['text'],
  verified: false,
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function parseCapabilities(value: unknown): DesktopModelCapabilities {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop model settings are malformed')
  const row = value as Partial<Record<keyof DesktopModelCapabilities, unknown>>
  if (
    typeof row.verified !== 'boolean'
    || !Array.isArray(row.input)
    || row.input.length === 0
    || row.input[0] !== 'text'
    || row.input.some(modality => modality !== 'text' && modality !== 'image')
    || (row.contextWindow !== undefined && !positiveInteger(row.contextWindow))
    || (row.maxOutputTokens !== undefined && !positiveInteger(row.maxOutputTokens))
  ) {
    throw new Error('Desktop model settings are malformed')
  }
  return row as DesktopModelCapabilities
}

/**
 * Parse current settings and upgrade records that predate capability verification.
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
  if (row.version === 1 || row.version === 2) {
    let computerUseEnabled = false
    if (row.version === 2) {
      if (typeof row.computerUseEnabled !== 'boolean') throw new Error('Desktop model settings are malformed')
      computerUseEnabled = row.computerUseEnabled
    }
    return {
      version: MODEL_SETTINGS_VERSION,
      baseURL: row.baseURL as string,
      model: row.model as string,
      protocol: row.protocol as DesktopModelProtocol,
      encryptedApiKey: row.encryptedApiKey as string,
      computerUseEnabled,
      capabilities: UNVERIFIED_CAPABILITIES,
    }
  }
  if (row.version !== MODEL_SETTINGS_VERSION || typeof row.computerUseEnabled !== 'boolean') {
    throw new Error('Desktop model settings are malformed')
  }
  return {
    ...row as unknown as StoredModelSettings,
    capabilities: parseCapabilities(row.capabilities),
  }
}
