/** Model and advertised reasoning selection for the next Desktop request. */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopModelSettings, DesktopReasoningLevel } from '../../shared.ts'
import css from './model-selector.module.css'

/** Slot lifecycle belongs to the client registry. */
export const inject = ['slots']

/** Select only saved profiles; an active turn keeps its host snapshot. */
export function DesktopModelSelector({ locked }: PropsRuntime<'conversation.input.model'>) {
  const [catalog, setCatalog] = useState<{ profiles: DesktopModelSettings[]; defaultId?: string }>({ profiles: [] })
  const [advertised, setAdvertised] = useState<Array<{ id: string; name: string }>>([])
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const isLive = (): boolean => live
    const refresh = (): void => {
      void window.dshDesktop.modelProfiles().then(async (value) => {
        if (!live) return
        setCatalog(value)
        if (value.defaultId !== undefined) {
          const directory = await window.dshDesktop.discoverModels()
          if (isLive()) setAdvertised(directory.models)
        } else setAdvertised([])
      })
        .catch((failure: unknown) => { if (live) setError(String(failure)) })
    }
    refresh()
    window.addEventListener('desktop-models-changed', refresh)
    return () => { live = false; window.removeEventListener('desktop-models-changed', refresh) }
  }, [])
  const selected = catalog.profiles.find(profile => profile.id === catalog.defaultId)
  const choose = async (id: string): Promise<void> => {
    setPending(true)
    setError('')
    try {
      if (id.startsWith('effort:') && selected !== undefined) {
        const effort = id.slice('effort:'.length)
        const { reasoning: _previous, ...limits } = selected.overrides ?? {}
        await window.dshDesktop.saveModelSettings({
          id: selected.id, name: selected.name, baseURL: selected.baseURL, model: selected.model,
          protocol: selected.protocol, computerUseEnabled: selected.computerUseEnabled,
          apiKey: '',
          overrides: { ...limits, ...(effort === 'auto' ? {} : { reasoning: effort as DesktopReasoningLevel }) },
          ...(selected.subagent === undefined ? {} : { subagent: { ...selected.subagent, apiKey: '' } }),
        })
      } else if (id.startsWith('catalog:')) {
        await window.dshDesktop.selectModel(id.slice('catalog:'.length))
      } else {
        await window.dshDesktop.selectProfile(id.slice('model:'.length))
      }
      window.dispatchEvent(new Event('desktop-models-changed'))
      setOpen(false)
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { setPending(false) }
  }
  return <span className={css.root}>
    <Menu open={open} onClose={() => { setOpen(false) }} portal align="end"
      items={[
        ...catalog.profiles.map(profile => ({ id: `model:${profile.id}`, label: `${profile.id === catalog.defaultId ? '✓ ' : ''}${profile.name || profile.model}`, disabled: pending })),
        ...advertised.map(model => ({ id: `catalog:${model.id}`, label: `接口模型：${model.name}`, disabled: pending })),
        ...(selected === undefined ? [] : [{ id: 'effort:auto', label: '思考：自动', disabled: pending },
          ...Object.keys(selected.capabilities.reasoningEfforts ?? {}).map(level => ({ id: `effort:${level}`, label: `思考：${level}`, disabled: pending }))]),
      ]}
      onSelect={(id) => { void choose(id) }}
      anchor={<button className={css.trigger} type="button" aria-label="模型选择" aria-expanded={open}
        disabled={locked || pending || catalog.profiles.length === 0} onClick={() => { setOpen(!open) }}>
        <span className={css.name}>{selected?.name || selected?.model || '尚未配置模型'}</span>
        {selected?.overrides?.reasoning && <span className={css.effort}>{selected.overrides.reasoning}</span>}
        <span aria-hidden>⌄</span>
      </button>} />
    {error && <span className={css.error} role="alert">{error}</span>}
  </span>
}

/** Mount the existing model seat directly before the composer send controls. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({ name: 'conversation.input.model', priority: 10 }, DesktopModelSelector))
}
