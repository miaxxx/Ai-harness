/** Desktop composer model menu backed by the privileged model controller. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DesktopModelController } from './controller.ts'
import css from './model-picker.module.css'

/**
 * Render the active model and a keyboard-accessible directory immediately before Send.
 * @param props - Plugin-owned state and current-session interaction locks.
 * @returns The model menu and inline operation status.
 */
export function DesktopModelPicker({ controller, locked = false, running = false }: {
  controller: DesktopModelController
  locked?: boolean
  running?: boolean
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const disabled = locked || running || state.busy || !state.settings?.configured

  useEffect(() => { void controller.load().catch(() => { /* Controller publishes a visible load error. */ }) }, [controller])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus()
    return () => { document.removeEventListener('mousedown', outside) }
  }, [open])

  const choose = async (id: string): Promise<void> => {
    setOpen(false)
    trigger.current?.focus()
    try { await controller.select(id) } catch { /* Controller retains the working model and publishes the error. */ }
  }

  return (
    <div ref={root} className={css.root} data-desktop-model-picker onKeyDown={(event) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
      if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      }
    }}>
      <button ref={trigger} type="button" className={css.trigger} aria-label={`选择模型：${state.settings?.model || '未配置'}`}
        aria-haspopup="menu" aria-expanded={open} disabled={disabled}
        title={running ? '回复完成后可以切换模型' : '选择后用于后续请求'} onClick={() => { setOpen(!open) }}>
        <span>{state.busy ? '模型处理中…' : state.settings?.model || '选择模型'}</span><span aria-hidden>⌄</span>
      </button>
      {open && <div className={css.menu} role="menu" aria-label="模型选项">
        <div className={css.heading}>选择模型 <small>{state.catalog?.models.length ?? 0} 个</small></div>
        <div className={css.list}>
          {state.catalog?.models.map(model => <button key={model.id} type="button" role="menuitemradio"
            aria-checked={model.id === state.settings?.model} className={css.option} disabled={disabled}
            onClick={() => { void choose(model.id) }}>
            <span><strong>{model.name}</strong>{model.name !== model.id && <small>{model.id}</small>}</span>
            {model.id === state.settings?.model && <span aria-hidden>✓</span>}
          </button>)}
        </div>
        {state.catalog?.warning && <p className={css.warning}>{state.catalog.warning}；保留已配置模型。</p>}
        <button type="button" className={css.refresh} disabled={state.busy} onClick={() => {
          void controller.detect().catch(() => { /* Controller displays refresh failures. */ })
        }}>重新检测模型</button>
      </div>}
      {state.error && <span className={css.error} role="alert">{state.error}</span>}
    </div>
  )
}
