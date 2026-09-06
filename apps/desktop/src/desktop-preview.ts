/** Desktop browser-panel state, target routing, and host handoff. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopBridge, DesktopPreparedPreview, DesktopPreviewTarget } from './shared.ts'

const AUTO_PREVIEW_EXTENSIONS = new Set([
  '.html', '.htm', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.docx', '.xlsx', '.pptx',
])

interface DesktopPreviewState {
  target: DesktopPreviewTarget | null
  visible: boolean
  loading: boolean
}

type DesktopPreviewActions = {
  open: (draft: DesktopPreviewState, target: DesktopPreviewTarget) => void
  collapse: (draft: DesktopPreviewState) => void
  clear: (draft: DesktopPreviewState) => void
  reopen: (draft: DesktopPreviewState) => void
  setLoading: (draft: DesktopPreviewState, loading: boolean) => void
  updateBrowser: (draft: DesktopPreviewState, update: { url?: string; title?: string }) => void
}

/** Create the transient state owned by the Desktop preview overlay entry. */
export function createDesktopPreviewStore(): EngineStoreHandle<DesktopPreviewState, DesktopPreviewActions> {
  return defineStore({
    init: (): DesktopPreviewState => ({ target: null, visible: false, loading: false }),
    actions: {
      open: (draft, target) => { draft.target = target; draft.visible = true; draft.loading = target.kind === 'browser' },
      collapse: (draft) => { draft.visible = false; draft.loading = false },
      clear: (draft) => { draft.target = null; draft.visible = false; draft.loading = false },
      reopen: (draft) => { if (draft.target !== null) draft.visible = true },
      setLoading: (draft, loading) => { draft.loading = loading },
      updateBrowser: (draft, update) => {
        if (draft.target?.kind !== 'browser') return
        if (update.url !== undefined) draft.target.url = update.url
        if (update.title !== undefined) draft.target.title = update.title
      },
    },
  })
}

type PreviewActions = BoundActions<ReturnType<typeof createDesktopPreviewStore>>
type PreviewBridge = Pick<DesktopBridge, 'openPath' | 'preparePreview'>

/** Normalize address-bar input to an HTTP(S) URL; reject executable or opaque schemes. */
export function normalizePreviewUrl(value: string): string {
  const input = value.trim()
  if (input === '') return 'about:blank'
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(input) ? input : `https://${input}`
  const parsed = new URL(candidate)
  if (!['http:', 'https:', 'about:'].includes(parsed.protocol)) {
    throw new Error('应用内浏览器仅支持 HTTP 和 HTTPS 网址')
  }
  if (parsed.protocol === 'about:' && parsed.href !== 'about:blank') {
    throw new Error('应用内浏览器不支持此内部页面')
  }
  return parsed.href
}

/** Pick the first user-facing artifact suitable for automatic preview. */
export function selectAutoPreviewArtifact(paths: readonly string[]): string | undefined {
  return paths.find((path) => {
    const name = path.replaceAll('\\', '/').split('/').pop() ?? path
    const dot = name.lastIndexOf('.')
    return dot >= 0 && AUTO_PREVIEW_EXTENSIONS.has(name.slice(dot).toLowerCase())
  })
}

function targetFor(prepared: Extract<DesktopPreparedPreview, { kind: 'file' }>): DesktopPreviewTarget {
  if (prepared.previewable) {
    return {
      kind: 'browser',
      url: prepared.url,
      title: prepared.title,
      external: prepared.path,
      mediaType: prepared.mediaType,
    }
  }
  return {
    kind: 'external-file',
    path: prepared.path,
    title: prepared.title,
    mediaType: prepared.mediaType,
  }
}

/** Routes file and URL intents into the mounted Desktop preview overlay. */
export class DesktopPreviewController {
  private actions: PreviewActions | undefined

  constructor(private readonly bridge: PreviewBridge) {}

  attach(actions: PreviewActions): void {
    this.actions = actions
  }

  async openPath(path: string): Promise<void> {
    const prepared = await this.bridge.preparePreview(path)
    if (prepared.kind === 'directory') {
      await this.bridge.openPath(prepared.path)
      return
    }
    this.requireActions().open(targetFor(prepared))
  }

  openUrl(value: string): void {
    const url = normalizePreviewUrl(value)
    this.requireActions().open({
      kind: 'browser', url, title: url === 'about:blank' ? '新标签页' : url,
      external: url, mediaType: 'text/html',
    })
  }

  /** Hide the panel but preserve its current tab so reopening restores it. */
  collapse(): void {
    this.requireActions().collapse()
  }

  /** Remove the active tab; the next panel opening starts on a new browser tab. */
  clear(): void {
    this.requireActions().clear()
  }

  /** Reopen the preserved panel tab, when one exists. */
  reopen(): void {
    this.requireActions().reopen()
  }

  /** Clear any preview when a new conversation is created. */
  resetForNewConversation(): void {
    this.clear()
  }

  private requireActions(): PreviewActions {
    if (this.actions === undefined) throw new Error('desktop preview: panel actions are not mounted')
    return this.actions
  }
}
