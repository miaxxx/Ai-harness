import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopWebSearchSettings } from './shared.ts'
import css from './desktop-model-settings.module.css'

/** Required client services for the Desktop-owned web-search settings section. */
export const inject = ['slots']

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8m-3 3 3 3m-6 0 3 3" />
    </svg>
  )
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Desktop You.com credential editor backed by encrypted Main-process storage. */
export function DesktopWebSearchSettingsSection() {
  const [loaded, setLoaded] = useState<DesktopWebSearchSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    void window.dshDesktop.webSearchSettings().then((settings) => {
      if (live) setLoaded(settings)
    }).catch((error: unknown) => {
      if (live) setMessage({ kind: 'error', text: publicError(error) })
    })
    return () => { live = false }
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    setMessage(null)
    try {
      const settings = await window.dshDesktop.saveWebSearchSettings({ apiKey })
      setLoaded(settings)
      setApiKey('')
      setMessage({ kind: 'success', text: 'You.com API Key 已安全保存，网页搜索现在可用。' })
    } catch (error: unknown) {
      setMessage({ kind: 'error', text: publicError(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={css.root} aria-labelledby="desktop-web-search-title">
      <header className={css.heading}>
        <span className={css.headingIcon}><SearchIcon /></span>
        <div>
          <div className={css.titleRow}>
            <h2 id="desktop-web-search-title">网页搜索</h2>
            <span className={css.primaryBadge}>You.com</span>
          </div>
          <p>配置 You.com Search API，用于需要最新网页信息的任务。</p>
        </div>
      </header>

      <div className={css.card}>
        <label className={css.field}>
          <span className={css.keyLabel}><KeyIcon /> You.com API Key</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={loaded?.apiKeyConfigured === true ? '已安全保存；留空表示不修改' : '输入 You.com API Key'}
            onChange={(event) => { setApiKey(event.target.value) }}
          />
          <small>密钥由 macOS 安全存储加密。它不会显示给对话、写入普通设置文件，或发送给模型。</small>
        </label>

        <div className={css.footer}>
          <div className={css.status} aria-live="polite" data-kind={message?.kind}>
            {loaded === null && message === null ? '正在读取配置…' : message?.text}
          </div>
          <button
            type="button"
            className={css.save}
            disabled={saving || loaded === null || (!loaded.apiKeyConfigured && apiKey.trim() === '')}
            onClick={() => { void save() }}
          >
            {saving ? '正在保存…' : '保存 API Key'}
          </button>
        </div>
      </div>
    </section>
  )
}

/** Register the Desktop You.com settings section into the shared Settings shell. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'web-search', order: 15, label: '网页搜索',
  }, DesktopWebSearchSettingsSection))
}
