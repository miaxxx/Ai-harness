import { describe, expect, it } from 'vitest'
import { effectiveModelCapabilities, parseModelOverrides } from '../src/desktop-model-policy.ts'
import { catalogModelCapabilities } from '../src/desktop-model-capabilities.ts'
import { parseStoredModelSettings } from '../src/desktop-model-storage.ts'

describe('model limits and advertised reasoning', () => {
  const detected = { input: ['text'] as ['text'], verified: true, contextWindow: 131072, maxOutputTokens: 8192, contextSource: 'interface' as const, reasoningEfforts: { low: 'small', high: 'large' } }
  it('preserves manual capacities across refreshed interface metadata and restores automatic values', () => {
    const overrides = parseModelOverrides({ contextWindow: 1048576, maxOutputTokens: 16384, reasoning: 'high' })
    expect(effectiveModelCapabilities(detected, overrides)).toMatchObject({ contextWindow: 1048576, maxOutputTokens: 16384 })
    expect(effectiveModelCapabilities({ ...detected, contextWindow: 262144 }, overrides).contextWindow).toBe(1048576)
    expect(effectiveModelCapabilities(detected, {}).contextWindow).toBe(131072)
    expect(detected.contextWindow).toBe(131072)
  })
  it('rejects invalid limits and reasoning that the endpoint did not advertise', () => {
    for (const contextWindow of [0, -1, 1.5, '128K', Infinity]) expect(() => parseModelOverrides({ contextWindow })).toThrow()
    expect(() => effectiveModelCapabilities(detected, { contextWindow: 4096 })).toThrow('最大输出')
    expect(() => effectiveModelCapabilities(detected, { reasoning: 'max' })).toThrow('未声明')
    expect(() => effectiveModelCapabilities({ input: ['text'], verified: true }, { reasoning: 'high' })).toThrow()
  })
  it('uses catalog metadata only for an exact official endpoint and protocol', async () => {
    expect(await catalogModelCapabilities({ baseURL: 'https://api.openai.com/v1', model: 'gpt-5.2', protocol: 'openai-responses' })).toMatchObject({ contextSource: 'catalog' })
    expect(await catalogModelCapabilities({ baseURL: 'https://gateway.example/v1', model: 'gpt-5.2', protocol: 'openai-responses' })).toEqual({})
  })
  it('validates persisted manual overrides and provider wire mappings', () => {
    const profile = { version: 4, id: 'profile', name: 'Work', baseURL: 'https://gateway.example/v1', model: 'work', protocol: 'openai-completions', encryptedApiKey: 'encrypted', computerUseEnabled: false, capabilities: detected, overrides: { contextWindow: 1048576, reasoning: 'high' } }
    expect(parseStoredModelSettings(profile)).toEqual(profile)
    expect(() => parseStoredModelSettings({ ...profile, overrides: { contextWindow: 0 } })).toThrow()
    expect(() => parseStoredModelSettings({ ...profile, capabilities: { ...detected, reasoningEfforts: { high: null } } })).toThrow()
  })
})
