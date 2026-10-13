/** Versioned parsing for Desktop primary-model settings stored by Electron Main. */

import { parseModelOverrides, REASONING_LEVELS } from './desktop-model-policy.ts'
import type { DesktopModelCapabilities, DesktopModelOverrides, DesktopModelProtocol } from './shared.ts'

/** Current Desktop primary- and optional subagent-model settings format. */
export const MODEL_SETTINGS_VERSION = 4

/** Dedicated subagent endpoint retained in the privileged Electron user-data directory. */
export interface StoredSubagentModelSettings {
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  encryptedApiKey: string
  capabilities: DesktopModelCapabilities
  overrides?: DesktopModelOverrides
}

/** Primary-model settings retained in the privileged Electron user-data directory. */
export interface StoredModelSettings {
  id?: string
  name?: string
  overrides?: DesktopModelOverrides
  version: typeof MODEL_SETTINGS_VERSION
  baseURL: string
  model: string
  protocol: DesktopModelProtocol
  encryptedApiKey: string
  computerUseEnabled: boolean
  capabilities: DesktopModelCapabilities
  /** Omission is the durable inherit-parent mode; no primary values are copied here. */
  subagent?: StoredSubagentModelSettings
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
  for (const key of ['contextSource', 'outputSource'] as const) {
    if (row[key] !== undefined && row[key] !== 'interface' && row[key] !== 'catalog') throw new Error('Desktop model metadata source is malformed')
  }
  if (row.reasoningEfforts !== undefined) {
    if (typeof row.reasoningEfforts !== 'object' || row.reasoningEfforts === null || Array.isArray(row.reasoningEfforts)
      || !Object.entries(row.reasoningEfforts).every(([key, entry]) => REASONING_LEVELS.includes(key as typeof REASONING_LEVELS[number]) && ((key === 'off' && entry === null) || (typeof entry === 'string' && entry.length > 0)))) {
      throw new Error('Desktop model reasoning mapping is malformed')
    }
  }
  return row as DesktopModelCapabilities
}

/** Parse one optional dedicated endpoint without accepting a partial record. */
function parseSubagent(value: unknown): StoredSubagentModelSettings {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop model settings are malformed')
  const row = value as Partial<Record<keyof StoredSubagentModelSettings, unknown>>
  if (
    typeof row.baseURL !== 'string'
    || typeof row.model !== 'string'
    || !MODEL_PROTOCOLS.includes(row.protocol as DesktopModelProtocol)
    || typeof row.encryptedApiKey !== 'string'
  ) {
    throw new Error('Desktop model settings are malformed')
  }
  return {
    baseURL: row.baseURL,
    model: row.model,
    protocol: row.protocol as DesktopModelProtocol,
    encryptedApiKey: row.encryptedApiKey,
    capabilities: parseCapabilities(row.capabilities),
    ...(row.overrides === undefined ? {} : { overrides: parseModelOverrides(row.overrides) }),
  }
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
  if (row.version === 3) {
    if (typeof row.computerUseEnabled !== 'boolean') throw new Error('Desktop model settings are malformed')
    return {
      version: MODEL_SETTINGS_VERSION,
      baseURL: row.baseURL as string,
      model: row.model as string,
      protocol: row.protocol as DesktopModelProtocol,
      encryptedApiKey: row.encryptedApiKey as string,
      computerUseEnabled: row.computerUseEnabled,
      capabilities: parseCapabilities(row.capabilities),
    }
  }
  if (row.version !== MODEL_SETTINGS_VERSION || typeof row.computerUseEnabled !== 'boolean') {
    throw new Error('Desktop model settings are malformed')
  }
  if ((row.id !== undefined && (typeof row.id !== 'string' || row.id === '')) || (row.name !== undefined && typeof row.name !== 'string')) throw new Error('Desktop model identity is malformed')
  return {
    ...row as unknown as StoredModelSettings,
    ...(row.overrides === undefined ? {} : { overrides: parseModelOverrides(row.overrides) }),
    capabilities: parseCapabilities(row.capabilities),
    ...row.subagent === undefined ? {} : { subagent: parseSubagent(row.subagent) },
  }
}
