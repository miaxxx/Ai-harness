/** Desktop-only browser and artifact preview overlay plugin. */

import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import type { BoundActions, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { DesktopPreviewTarget } from './shared.ts'
import {
  createDesktopPreviewStore, DesktopPreviewController, normalizePreviewUrl,
} from './desktop-preview.ts'
import css from './desktop-preview-ui.module.css'

type PreviewActions = BoundActions<ReturnType<typeof createDesktopPreviewStore>>

interface DesktopPreviewInjected {
  collapse: () => void
  clear: () => void
  reopen: () => void
  navigate: (value: string) => void
  openOutside: (target: DesktopPreviewTarget) => Promise<void>
}

type DesktopPreviewProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createDesktopPreviewStore>>
  & DesktopPreviewInjected

function GlobeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 12h17M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21M12 3C9.6 5.5 8.4 8.5 8.4 12S9.6 18.5 12 21" stroke="currentColor" strokeWidth="1.5" /></svg>
}

function PanelRightIcon() {
  return <svg className={css.panelRightIcon} viewBox="0 0 16 16" fill="none" aria-hidden><path fillRule="evenodd" clipRule="evenodd" d="M9.67272.52284c1.16118 0 2.08728-.00013 2.82358.07965.749.08117 1.3826.25176 1.9301.64948.324.23542.6091.5205.8445.84453.3977.54744.5683 1.18108.6495 1.93005C16.0002 4.7629 16 5.68895 16 6.85014v2.29972c0 1.16124.0002 2.08724-.0796 2.82364-.0812.7489-.2518 1.3826-.6495 1.93-.2354.324-.5205.6091-.8445.8445-.5475.3978-1.1811.5683-1.9301.6495-.7363.0798-1.6624.0797-2.82358.0797H6.3273c-1.16119 0-2.08724.0001-2.82359-.0797-.74897-.0812-1.38261-.2517-1.93005-.6495-.32403-.2354-.609111-.5205-.844529-.8445C.331407 13.3561.160817 12.7224.079653 11.9735-.000126 11.2371 0 10.3111 0 9.14986V6.85014c0-1.16119-.000126-2.08724.079653-2.82359.081164-.74897.251754-1.38261.649478-1.93005.235418-.32403.520499-.60911.844529-.84453C2.1211.85425 2.75474.68366 3.50371.60249 4.24006.52271 5.16611.52284 6.3273.52284h3.34542ZM5.54303 1.88715V14.1118c.24333.001.50406.0051.78427.0051h3.34542c1.19118 0 2.03048-.0005 2.67658-.0704.6331-.0686 1.0004-.1971 1.2775-.3983.2086-.1516.3927-.3357.5443-.5443.2012-.2771.3296-.6444.3982-1.2775.07-.6461.0705-1.4854.0705-2.67654V6.85014c0-1.19118-.0005-2.03047-.0705-2.67654-.0686-.63312-.197-1.00042-.3982-1.27751-.1516-.20862-.3357-.39272-.5443-.5443-.2771-.20119-.6444-.32967-1.2775-.39826-.6461-.06995-1.4854-.07046-2.67658-.07046H6.3273c-.28021 0-.54094.00313-.78427.00408Zm-1.36023.02451c-.19155.00994-.368.02411-.53204.04187-.63312.06859-1.00042.19707-1.27751.39826-.20862.15158-.39273.33568-.5443.5443-.20119.27709-.32967.64439-.39826 1.27751-.06995.64607-.07046 1.48536-.07046 2.67654v2.29972c0 1.19114.00051 2.03044.07046 2.67654.06859.6331.19707 1.0004.39826 1.2775.15157.2086.33568.3927.5443.5443.27709.2012.64439.3297 1.27751.3983.16402.0177.34051.0309.53204.0408V1.91166Z" fill="currentColor" /></svg>
}

function FullscreenIcon({ active }: { active: boolean }) {
  return active
    ? <svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="m8.5 8.5-4-4m0 0v3.4m0-3.4h3.4m3.6 7 4 4m0 0v-3.4m0 3.4h-3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="m8.5 11.5-4 4m0 0v-3.4m0 3.4h3.4m3.6-7 4-4m0 0v3.4m0-3.4h-3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function IconButton(props: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string | undefined
}) {
  return <button type="button" className={`${css.iconButton} ${props.className ?? ''}`} aria-label={props.label} {...props.disabled === undefined ? {} : { disabled: props.disabled }} onClick={props.onClick}>{props.children}</button>
}

function DesktopPreviewPanel({ useStore, actions, collapse, clear, reopen, navigate, openOutside }: DesktopPreviewProps) {
  const target = useStore(state => state.target)
  const visible = useStore(state => state.visible)
  const loading = useStore(state => state.loading)
  const webviewRef = useRef<WebviewTag | null>(null)
  const [address, setAddress] = useState(target?.kind === 'browser' ? target.url : '')
  const [history, setHistory] = useState({ back: false, forward: false })
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(() => Math.min(680, Math.max(420, window.innerWidth * .42)))

  const widthLimits = (): { min: number; max: number } => ({
    min: Math.min(420, window.innerWidth),
    max: Math.max(Math.min(960, window.innerWidth - 320), Math.min(420, window.innerWidth)),
  })
  const resizeTo = (width: number): void => {
    const { min, max } = widthLimits()
    setPanelWidth(Math.min(max, Math.max(min, width)))
  }

  useLayoutEffect(() => {
    if (!visible) {
      document.body.removeAttribute('data-desktop-preview-open')
      document.body.removeAttribute('data-desktop-preview-fullscreen')
    } else {
      document.body.setAttribute('data-desktop-preview-open', '')
      document.body.style.setProperty('--dsh-desktop-preview-width', `${panelWidth}px`)
      if (fullscreen) document.body.setAttribute('data-desktop-preview-fullscreen', '')
      else document.body.removeAttribute('data-desktop-preview-fullscreen')
    }
    return () => {
      document.body.removeAttribute('data-desktop-preview-open')
      document.body.removeAttribute('data-desktop-preview-fullscreen')
      document.body.removeAttribute('data-desktop-preview-resizing')
      document.body.style.removeProperty('--dsh-desktop-preview-width')
    }
  }, [fullscreen, panelWidth, visible])

  useEffect(() => {
    if (!visible) setFullscreen(false)
  }, [visible])

  useEffect(() => {
    if (target?.kind === 'browser') setAddress(target.url === 'about:blank' ? '' : target.url)
  }, [target])

  useEffect(() => {
    const webview = webviewRef.current
    if (webview === null) return
    const syncNavigation = (event: Event): void => {
      const detail = event as Event & { url?: string }
      const url = detail.url ?? webview.getURL()
      setAddress(url === 'about:blank' ? '' : url)
      setHistory({ back: webview.canGoBack(), forward: webview.canGoForward() })
      actions.updateBrowser({ url })
    }
    const syncTitle = (event: Event): void => {
      const title = (event as Event & { title?: string }).title
      if (title !== undefined && title !== '') actions.updateBrowser({ title })
    }
    const start = (): void => { actions.setLoading(true); setError('') }
    const stop = (): void => { actions.setLoading(false) }
    const fail = (event: Event): void => {
      const detail = event as Event & { errorDescription?: string; errorCode?: number }
      if (detail.errorCode === -3) return
      actions.setLoading(false)
      setError(detail.errorDescription ?? '页面加载失败')
    }
    webview.addEventListener('did-navigate', syncNavigation)
    webview.addEventListener('did-navigate-in-page', syncNavigation)
    webview.addEventListener('page-title-updated', syncTitle)
    webview.addEventListener('did-start-loading', start)
    webview.addEventListener('did-stop-loading', stop)
    webview.addEventListener('did-fail-load', fail)
    return () => {
      webview.removeEventListener('did-navigate', syncNavigation)
      webview.removeEventListener('did-navigate-in-page', syncNavigation)
      webview.removeEventListener('page-title-updated', syncTitle)
      webview.removeEventListener('did-start-loading', start)
      webview.removeEventListener('did-stop-loading', stop)
      webview.removeEventListener('did-fail-load', fail)
    }
  }, [actions, target])

  if (!visible || target === null) {
    return <button type="button" className={`${css.launcher} ${css.floatingLauncher}`} aria-label="打开应用内浏览器" title="浏览器" onClick={() => {
      if (target === null) navigate('about:blank')
      else reopen()
    }}><PanelRightIcon /></button>
  }
  const browser = target.kind === 'browser'
  const blank = browser && target.url === 'about:blank'
  const webview = webviewRef.current
  const submitAddress = (): void => {
    try { navigate(normalizePreviewUrl(address)); setError('') }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (fullscreen) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.setAttribute('data-desktop-preview-resizing', '')
  }
  const continueResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTo(window.innerWidth - event.clientX)
  }
  const stopResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.removeAttribute('data-desktop-preview-resizing')
  }
  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (fullscreen || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    resizeTo(panelWidth + (event.key === 'ArrowLeft' ? 24 : -24))
  }
  const limits = widthLimits()
  return (
    <aside className={css.panel} aria-label="应用内浏览器" data-desktop-preview data-fullscreen={fullscreen || undefined}>
      <div className={css.resizeHandle} role="separator" aria-label="调整浏览器侧栏宽度" aria-orientation="vertical" aria-valuemin={Math.round(limits.min)} aria-valuemax={Math.round(limits.max)} aria-valuenow={Math.round(panelWidth)} tabIndex={fullscreen ? -1 : 0} onPointerDown={startResize} onPointerMove={continueResize} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={resizeByKeyboard} />
      <div className={css.tabBar}>
        <div className={css.tab}><GlobeIcon /><span>{target.title}</span>
          <IconButton label="关闭此标签页" onClick={clear}><svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="m6 6 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></IconButton>
        </div>
        <IconButton className={css.newTab} label="新标签页" onClick={() => { navigate('about:blank') }}><svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></IconButton>
        <div className={css.windowActions}>
          <IconButton label={fullscreen ? '退出全屏预览' : '全屏预览'} onClick={() => { setFullscreen(value => !value) }}><FullscreenIcon active={fullscreen} /></IconButton>
          <IconButton className={css.collapseButton} label="收起浏览器侧栏" onClick={collapse}><PanelRightIcon /></IconButton>
        </div>
      </div>
      <div className={css.toolbar}>
        <IconButton label="后退" disabled={!browser || !history.back} onClick={() => { webview?.goBack() }}><svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="m11.5 5-5 5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></IconButton>
        <IconButton label="前进" disabled={!browser || !history.forward} onClick={() => { webview?.goForward() }}><svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="m8.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></IconButton>
        <IconButton label="刷新" disabled={!browser} onClick={() => { webview?.reload() }}><svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="M15.4 7.3A6 6 0 1 0 16 10M15.4 7.3V3.8m0 3.5h-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></IconButton>
        <form className={css.addressForm} onSubmit={(event) => { event.preventDefault(); submitAddress() }}>
          <input className={css.address} aria-label="网址" value={address} placeholder="搜索或输入网址" onChange={(event) => { setAddress(event.currentTarget.value) }} />
        </form>
        <IconButton label="在外部打开" disabled={target.kind === 'browser' && target.external === 'about:blank'} onClick={() => { void openOutside(target).catch((cause: unknown) => { setError(String(cause)) }) }}><svg viewBox="0 0 20 20" fill="none" aria-hidden><path d="M11 4h5v5m0-5-7 7M15 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></IconButton>
      </div>
      <div className={css.progress} data-loading={loading || undefined} />
      <div className={css.content}>
        {blank
          ? <div className={css.empty}><GlobeIcon /><h2>开始浏览</h2><p>输入 URL 以打开页面</p></div>
          : browser
            ? createElement('webview', {
              ref: (element: WebviewTag | null): void => { webviewRef.current = element },
              className: css.webview,
              src: target.url,
              partition: 'dsh-preview',
            })
            : <div className={css.empty}><GlobeIcon /><h2>此格式需要外部应用</h2><p>{target.title} 无法由 Chromium 直接渲染。你仍可在这里管理该产物，或交给系统默认应用打开。</p><button type="button" className={css.openButton} onClick={() => { void openOutside(target) }}>用系统应用打开</button></div>}
        {error !== '' && <div className={css.empty} role="alert"><h2>无法打开页面</h2><p>{error}</p></div>}
      </div>
    </aside>
  )
}

/** Build the Desktop browser overlay plugin around its host-facing controller. */
export function desktopPreviewPlugin(controller: DesktopPreviewController) {
  return {
    inject: ['slots'] as const,
    apply(ctx: ClientContext) {
      ctx.slots.register({
        name: 'shell.overlay', id: 'desktop-preview', order: 10,
        store: createDesktopPreviewStore,
        inject: (actions: PreviewActions): DesktopPreviewInjected => {
          controller.attach(actions)
          return {
            collapse: () => { controller.collapse() },
            clear: () => { controller.clear() },
            reopen: () => { controller.reopen() },
            navigate: (value) => { controller.openUrl(value) },
            openOutside: target => target.kind === 'browser' && /^https?:/iu.test(target.external)
              ? window.dshDesktop.openExternal(target.external)
              : window.dshDesktop.openPath(target.kind === 'browser' ? target.external : target.path),
          }
        },
      }, DesktopPreviewPanel)
    },
  }
}
