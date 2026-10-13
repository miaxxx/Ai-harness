// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DesktopModelSettingsSection } from '../src/models/renderer/model-settings.tsx'
import { DesktopModelSelector } from '../src/models/renderer/model-selector.tsx'
import type { DesktopModelSettings } from '../src/shared.ts'

const profile: DesktopModelSettings = { id: 'work', name: '工作模型', configured: true, baseURL: 'https://gateway.test/v1', model: 'work-model', protocol: 'openai-completions', apiKeyConfigured: true, computerUseEnabled: false,
  capabilities: { input: ['text'], verified: true, contextWindow: 1048576 },
  detectedCapabilities: { input: ['text'], verified: true, contextWindow: 131072, contextSource: 'interface' }, overrides: { contextWindow: 1048576 } }

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('shows saved models first and preserves manual limits across detection, then restores automatic settings', async () => {
  const saveModelSettings = vi.fn().mockResolvedValue(profile)
  const inspectModelSettings = vi.fn().mockResolvedValue({ input: ['text'], verified: true, contextWindow: 262144, contextSource: 'interface', reasoningEfforts: { high: 'high' } })
  Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { modelProfiles: vi.fn().mockResolvedValue({ profiles: [profile], defaultId: 'work' }), saveModelSettings, inspectModelSettings, discoverModels: vi.fn().mockResolvedValue({ models: [], source: 'endpoint' }) } })
  render(createElement(DesktopModelSettingsSection))
  expect(await screen.findByText('工作模型')).toBeTruthy()
  expect(screen.queryByLabelText('Base URL')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '编辑配置' }))
  const context = await screen.findByLabelText(/整个上下文窗口/) as HTMLInputElement
  expect(context.value).toBe('1048576')
  fireEvent.click(screen.getByRole('button', { name: '重新检测能力' }))
  await screen.findByText('检测完成，手动设置已保留。')
  expect(context.value).toBe('1048576')
  fireEvent.click(screen.getByRole('button', { name: '恢复自动参数' }))
  expect(context.value).toBe('')
  expect(context.placeholder).toBe('262144')
  fireEvent.change(screen.getByLabelText(/默认思考强度/), { target: { value: 'high' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型' }))
  await waitFor(() => { expect(saveModelSettings).toHaveBeenCalledWith(expect.objectContaining({ id: 'work', overrides: { reasoning: 'high' }, apiKey: '' })) })
})

it('selects a saved model before sending and exposes only advertised reasoning options', async () => {
  const selectProfile = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { modelProfiles: vi.fn().mockResolvedValue({ profiles: [profile, { ...profile, id: 'other', name: '另一模型' }], defaultId: 'work' }), selectProfile, discoverModels: vi.fn().mockResolvedValue({ models: [], source: 'endpoint' }) } })
  render(createElement(DesktopModelSelector, { locked: false } as Parameters<typeof DesktopModelSelector>[0]))
  await screen.findByText('工作模型')
  fireEvent.click(screen.getByRole('button', { name: '模型选择' }))
  expect(screen.queryByRole('menuitem', { name: '思考：high' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: '另一模型' }))
  await waitFor(() => { expect(selectProfile).toHaveBeenCalledWith('other') })
})

it('preserves model-directory selection alongside saved profiles in the same composer menu', async () => {
  const selectModel = vi.fn().mockResolvedValue(profile)
  Object.defineProperty(window, 'dshDesktop', { configurable: true, value: {
    modelProfiles: vi.fn().mockResolvedValue({ profiles: [profile], defaultId: 'work' }),
    discoverModels: vi.fn().mockResolvedValue({ models: [{ id: 'directory-model', name: 'Directory model' }], source: 'endpoint' }),
    selectModel,
  } })
  render(createElement(DesktopModelSelector, { locked: false } as Parameters<typeof DesktopModelSelector>[0]))
  await screen.findByText('工作模型')
  fireEvent.click(screen.getByRole('button', { name: '模型选择' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '接口模型：Directory model' }))
  await waitFor(() => { expect(selectModel).toHaveBeenCalledWith('directory-model') })
})
