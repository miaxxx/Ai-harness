import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopModelProtocol, DesktopModelSettings } from './shared.ts'
import css from './desktop-model-settings.module.css'

/** Required client services for the Desktop-owned Models settings section. */
export const inject = ['slots']

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
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

/** Desktop primary-model editor backed by encrypted Main-process storage. */
export function DesktopModelSettingsSection() {
  const [loaded, setLoaded] = useState<DesktopModelSettings | null>(null)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [protocol, setProtocol] = useState<DesktopModelProtocol>('openai-completions')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    void window.dshDesktop.modelSettings().then((settings) => {
      if (!live) return
      setLoaded(settings)
      setBaseURL(settings.baseURL)
      setModel(settings.model)
      setProtocol(settings.protocol)
    }).catch((error: unknown) => {
      if (live) setMessage({ kind: 'error', text: publicError(error) })
    })
    return () => { live = false }
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    setMessage(null)
    try {
      const settings = await window.dshDesktop.saveModelSettings({ baseURL, model, protocol, apiKey })
      setLoaded(settings)
      setApiKey('')
      setMessage({ kind: 'success', text: `已将 ${settings.model} 设为主模型，ACP Runtime 已重新连接。` })
    } catch (error: unknown) {
      setMessage({ kind: 'error', text: publicError(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={css.root} aria-labelledby="desktop-model-title">
      <header className={css.heading}>
        <span className={css.headingIcon}><DatabaseIcon /></span>
        <div>
          <div className={css.titleRow}>
            <h2 id="desktop-model-title">大模型 API</h2>
            <span className={css.primaryBadge}>主模型</span>
          </div>
          <p>配置 OpenAI 兼容接口。保存后，新请求与恢复的会话都会通过该模型运行。</p>
        </div>
      </header>

      <div className={css.card}>
        <label className={css.field}>
          <span>API 协议</span>
          <select value={protocol} onChange={(event) => { setProtocol(event.target.value as DesktopModelProtocol) }}>
            <option value="openai-completions">OpenAI Chat Completions</option>
            <option value="openai-responses">OpenAI Responses</option>
          </select>
        </label>

        <label className={css.field}>
          <span>Base URL</span>
          <input
            type="url"
            value={baseURL}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            onChange={(event) => { setBaseURL(event.target.value) }}
          />
        </label>

        <label className={css.field}>
          <span>模型 ID</span>
          <input
            value={model}
            placeholder="例如 gpt-5.2、qwen3-coder"
            spellCheck={false}
            onChange={(event) => { setModel(event.target.value) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.keyLabel}><KeyIcon /> API Key</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={loaded?.apiKeyConfigured === true ? '已安全保存；留空表示不修改' : '输入 API Key'}
            onChange={(event) => { setApiKey(event.target.value) }}
          />
          <small>密钥由 macOS 安全存储加密，Renderer 和配置文件不会读取明文。</small>
        </label>

        <div className={css.footer}>
          <div className={css.status} aria-live="polite" data-kind={message?.kind}>
            {loaded === null && message === null ? '正在读取配置…' : message?.text}
          </div>
          <button
            type="button"
            className={css.save}
            disabled={saving || loaded === null || baseURL.trim() === '' || model.trim() === '' || (!loaded.apiKeyConfigured && apiKey.trim() === '')}
            onClick={() => { void save() }}
          >
            {saving ? '正在应用…' : '保存并设为主模型'}
          </button>
        </div>
      </div>
    </section>
  )
}

/** Register the Desktop primary-model section into the shared Settings shell. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'models',
    order: 10,
    label: '模型 API',
  }, DesktopModelSettingsSection))
}
