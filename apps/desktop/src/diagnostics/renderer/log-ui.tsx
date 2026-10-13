/** Desktop-only actions for opening per-request local diagnostic evidence. */
import { useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './log-ui.module.css'

/** The slot registry owns lifecycle and session addressing. */
export const inject = ['slots']

/** Open a request's host-owned log and keep filesystem failures visible. */
export function DesktopLogAction({ sessionId, messageId }: PropsRuntime<'conversation.chat.assistant-actions'>) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const openLog = async (): Promise<void> => {
    setPending(true)
    setError('')
    try {
      await window.dshDesktop.openTurnLog(sessionId, messageId)
      setOpen(false)
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPending(false)
    }
  }
  return <span className={css.root}>
    <Menu open={open} onClose={() => { setOpen(false) }} portal align="end"
      items={[{ id: 'open-log', label: pending ? '正在打开…' : '打开本地日志文件', disabled: pending }]}
      onSelect={() => { void openLog() }}
      anchor={<Tooltip label="本轮任务日志" side="bottom">
        <button type="button" className={css.trigger} aria-label="本轮任务日志" aria-expanded={open}
          onClick={() => { setOpen(!open) }}>···</button>
      </Tooltip>} />
    {error !== '' && <span role="alert" className={css.error}>{error}</span>}
  </span>
}

/** Install log actions beside copy on both sides of the Desktop transcript. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions', id: 'desktop-log', order: 100,
  }, DesktopLogAction))
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'desktop-log', order: 100,
  }, DesktopLogAction))
}
