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
      capabilities: { input: ['text'], verified: false },
    })
  })

  it('upgrades version 2 settings for verification before optional modalities are enabled', () => {
    expect(parseStoredModelSettings({ version: 2, ...common, computerUseEnabled: true })).toEqual({
      version: MODEL_SETTINGS_VERSION,
      ...common,
      computerUseEnabled: true,
      capabilities: { input: ['text'], verified: false },
    })
  })

  it('accepts complete current settings', () => {
    const current = {
      version: MODEL_SETTINGS_VERSION,
      ...common,
      computerUseEnabled: true,
      capabilities: { input: ['text', 'image'], contextWindow: 65_536, maxOutputTokens: 8192, verified: true },
    }
    expect(parseStoredModelSettings(current)).toEqual(current)
  })

  it('upgrades version 3 settings into inherit-parent subagent mode', () => {
    expect(parseStoredModelSettings({
      version: 3,
      ...common,
      computerUseEnabled: false,
      capabilities: { input: ['text'], verified: true },
    })).toEqual({
      version: MODEL_SETTINGS_VERSION,
      ...common,
      computerUseEnabled: false,
      capabilities: { input: ['text'], verified: true },
    })
  })

  it('accepts a complete dedicated subagent endpoint', () => {
    const current = {
      version: MODEL_SETTINGS_VERSION,
      ...common,
      computerUseEnabled: false,
      capabilities: { input: ['text'], verified: true },
      subagent: {
        baseURL: 'https://worker.example/v1',
        model: 'worker-model',
        protocol: 'openai-responses',
        encryptedApiKey: 'worker-encrypted',
        capabilities: { input: ['text'], maxOutputTokens: 4096, verified: true },
      },
    } as const
    expect(parseStoredModelSettings(current)).toEqual(current)
  })

  it.each([
    null,
    { version: MODEL_SETTINGS_VERSION, ...common },
    { version: 2, ...common },
    { version: 99, ...common, computerUseEnabled: false },
    { version: MODEL_SETTINGS_VERSION, ...common, protocol: 'other', computerUseEnabled: false, capabilities: { input: ['text'], verified: true } },
    { version: MODEL_SETTINGS_VERSION, ...common, computerUseEnabled: false, capabilities: { input: ['image'], verified: true } },
    { version: MODEL_SETTINGS_VERSION, ...common, computerUseEnabled: false, capabilities: { input: ['text'], contextWindow: 0, verified: true } },
    { version: MODEL_SETTINGS_VERSION, ...common, computerUseEnabled: false, capabilities: { input: ['text'], verified: true }, subagent: {} },
  ])('rejects malformed or unsupported settings: %j', (value) => {
    expect(() => parseStoredModelSettings(value)).toThrow('Desktop model settings are malformed')
  })
})
