import { describe, expect, it } from 'vitest'
import { MODEL_SETTINGS_VERSION, parseStoredModelSettings } from '../src/desktop-model-storage.ts'

const common = {
  baseURL: 'https://example.test/v1',
  model: 'primary-model',
  protocol: 'openai-completions',
  encryptedApiKey: 'encrypted',
} as const

describe('Desktop model settings storage', () => {
  it('upgrades version 1 settings with Computer Use disabled', () => {
    expect(parseStoredModelSettings({ version: 1, ...common })).toEqual({
      version: MODEL_SETTINGS_VERSION,
      ...common,
      computerUseEnabled: false,
    })
  })

  it('accepts complete current settings', () => {
    const current = { version: MODEL_SETTINGS_VERSION, ...common, computerUseEnabled: true }
    expect(parseStoredModelSettings(current)).toEqual(current)
  })

  it.each([
    null,
    { version: MODEL_SETTINGS_VERSION, ...common },
    { version: 99, ...common, computerUseEnabled: false },
    { version: MODEL_SETTINGS_VERSION, ...common, protocol: 'other', computerUseEnabled: false },
  ])('rejects malformed or unsupported settings: %j', (value) => {
    expect(() => parseStoredModelSettings(value)).toThrow('Desktop model settings are malformed')
  })
})
