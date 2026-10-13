// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DesktopLogAction } from '../src/diagnostics/renderer/log-ui.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const props = { sessionId: 'session-id', messageId: 'message-id' } as Parameters<typeof DesktopLogAction>[0]

describe('Desktop diagnostic message action', () => {
  it('opens a tooltip menu and passes the addressed message identity to the host', async () => {
    const openTurnLog = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { openTurnLog } })
    render(createElement(DesktopLogAction, props))
    fireEvent.click(screen.getByRole('button', { name: '本轮任务日志' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开本地日志文件' }))
    await waitFor(() => { expect(openTurnLog).toHaveBeenCalledWith('session-id', 'message-id') })
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('exposes a missing file or filesystem failure beside the message', async () => {
    const openTurnLog = vi.fn().mockRejectedValue(new Error('本轮日志不存在'))
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { openTurnLog } })
    render(createElement(DesktopLogAction, props))
    fireEvent.click(screen.getByRole('button', { name: '本轮任务日志' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开本地日志文件' }))
    expect((await screen.findByRole('alert')).textContent).toBe('本轮日志不存在')
  })
})
