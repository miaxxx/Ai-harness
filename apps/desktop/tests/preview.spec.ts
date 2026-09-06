import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopPreviewStore,
  DesktopPreviewController,
  normalizePreviewUrl,
  selectAutoPreviewArtifact,
} from '../src/desktop-preview.ts'

describe('Desktop preview routing', () => {
  it('normalizes web addresses and rejects active schemes', () => {
    expect(normalizePreviewUrl('example.com/path')).toBe('https://example.com/path')
    expect(normalizePreviewUrl(' http://localhost:3000 ')).toBe('http://localhost:3000/')
    expect(normalizePreviewUrl('')).toBe('about:blank')
    expect(normalizePreviewUrl('about:blank')).toBe('about:blank')
    expect(() => normalizePreviewUrl('javascript:alert(1)')).toThrow('仅支持 HTTP 和 HTTPS')
    expect(() => normalizePreviewUrl('about:config')).toThrow('不支持此内部页面')
  })

  it('selects only user-facing artifacts for automatic preview', () => {
    expect(selectAutoPreviewArtifact(['src/a.ts', 'dist/report.HTML', 'notes.txt'])).toBe('dist/report.HTML')
    expect(selectAutoPreviewArtifact(['src/a.ts', 'styles/a.css'])).toBeUndefined()
    expect(selectAutoPreviewArtifact(['folder\\summary.PDF'])).toBe('folder\\summary.PDF')
  })

  it('opens browser-native and external-only files through one panel', async () => {
    const bridge = {
      openPath: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined),
      preparePreview: vi.fn()
        .mockResolvedValueOnce({
          kind: 'file' as const, path: '/w/report.html', url: 'file:///w/report.html',
          title: 'report.html', mediaType: 'text/html', previewable: true,
        })
        .mockResolvedValueOnce({
          kind: 'file' as const, path: '/w/report.docx', url: 'file:///w/report.docx',
          title: 'report.docx', mediaType: 'application/docx', previewable: false,
        })
        .mockResolvedValueOnce({ kind: 'directory' as const, path: '/w' }),
    }
    const instance = createDesktopPreviewStore().create()
    const controller = new DesktopPreviewController(bridge)
    controller.attach(instance.actions)

    await controller.openPath('/w/report.html')
    expect(instance.store.getSnapshot().target).toMatchObject({ kind: 'browser', url: 'file:///w/report.html' })
    await controller.openPath('/w/report.docx')
    expect(instance.store.getSnapshot().target).toMatchObject({ kind: 'external-file', path: '/w/report.docx' })
    await controller.openPath('/w')
    expect(bridge.openPath).toHaveBeenCalledWith('/w')
  })

  it('keeps browser state current, restores a collapsed tab, and clears only on close', () => {
    const instance = createDesktopPreviewStore().create()
    const controller = new DesktopPreviewController({ openPath: vi.fn(), preparePreview: vi.fn() })
    expect(() =>{  controller.openUrl('example.com') }).toThrow('panel actions are not mounted')
    controller.attach(instance.actions)
    controller.openUrl('example.com')
    instance.actions.setLoading(false)
    instance.actions.updateBrowser({ url: 'https://example.com/next', title: 'Next' })
    expect(instance.store.getSnapshot()).toMatchObject({
      loading: false,
      target: { kind: 'browser', url: 'https://example.com/next', title: 'Next' },
    })
    controller.collapse()
    instance.actions.updateBrowser({ title: 'ignored' })
    expect(instance.store.getSnapshot()).toMatchObject({
      visible: false,
      target: { kind: 'browser', title: 'ignored' },
    })
    controller.reopen()
    expect(instance.store.getSnapshot().visible).toBe(true)
    controller.clear()
    expect(instance.store.getSnapshot()).toEqual({ target: null, visible: false, loading: false })
  })
})
