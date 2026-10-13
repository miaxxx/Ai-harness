import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopModelProtocol, DesktopModelSettings, DesktopReasoningLevel } from '../../shared.ts'
import css from './model-settings.module.css'

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
interface ModelEditorProps {
  initial: DesktopModelSettings
  profiles: DesktopModelSettings[]
  onSaved: () => void
  onBack: () => void
}
function ModelEditor({ initial, profiles, onSaved, onBack }: ModelEditorProps) {
  const [directory, setDirectory] = useState<Array<{ id: string; name: string }>>([])
  const [loaded, setLoaded] = useState<DesktopModelSettings | null>(null)
  const [name, setName] = useState(initial.name ?? '')
  const [context, setContext] = useState(String(initial.overrides?.contextWindow ?? ''))
  const [output, setOutput] = useState(String(initial.overrides?.maxOutputTokens ?? ''))
  const [reasoning, setReasoning] = useState<DesktopReasoningLevel | ''>(initial.overrides?.reasoning ?? '')
  const [reuseKeyFrom, setReuseKeyFrom] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [protocol, setProtocol] = useState<DesktopModelProtocol>('openai-completions')
  const [apiKey, setApiKey] = useState('')
  const [computerUseEnabled, setComputerUseEnabled] = useState(false)
  const [subagentExpanded, setSubagentExpanded] = useState(false)
  const [subagentConfigured, setSubagentConfigured] = useState(false)
  const [subagentBaseURL, setSubagentBaseURL] = useState('')
  const [childContext, setChildContext] = useState(String(initial.subagent?.overrides?.contextWindow ?? ''))
  const [childOutput, setChildOutput] = useState(String(initial.subagent?.overrides?.maxOutputTokens ?? ''))
  const [subagentModel, setSubagentModel] = useState('')
  const [subagentProtocol, setSubagentProtocol] = useState<DesktopModelProtocol>('openai-completions')
  const [subagentApiKey, setSubagentApiKey] = useState('')
  const [recheck, setRecheck] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    void Promise.resolve(initial).then((settings) => {
      if (!live) return
      setLoaded(settings)
      setBaseURL(settings.baseURL)
      setModel(settings.model)
      setProtocol(settings.protocol)
      setComputerUseEnabled(settings.computerUseEnabled)
      if (settings.subagent !== undefined) {
        setSubagentExpanded(true)
        setSubagentConfigured(true)
        setSubagentBaseURL(settings.subagent.baseURL)
        setSubagentModel(settings.subagent.model)
        setSubagentProtocol(settings.subagent.protocol)
      }
    }).catch((error: unknown) => {
      if (live) setMessage({ kind: 'error', text: publicError(error) })
    })
    return () => { live = false }
  }, [initial])

  const save = async (): Promise<void> => {
    setSaving(true)
    setMessage(null)
    try {
      const settings = await window.dshDesktop.saveModelSettings({
        id: initial.id,
        recheck,
        name,
        reuseKeyFrom: reuseKeyFrom || undefined,
        overrides: { ...(context === '' ? {} : { contextWindow: Number(context) }), ...(output === '' ? {} : { maxOutputTokens: Number(output) }), ...(reasoning === '' ? {} : { reasoning }) },
        baseURL,
        model,
        protocol,
        apiKey,
        computerUseEnabled,
        ...subagentConfigured
          ? {
            subagent: {
              baseURL: subagentBaseURL,
              model: subagentModel,
              protocol: subagentProtocol,
              apiKey: subagentApiKey,
              overrides: { ...(childContext === '' ? {} : { contextWindow: Number(childContext) }), ...(childOutput === '' ? {} : { maxOutputTokens: Number(childOutput) }) },
            },
          }
          : {},
      })
      setLoaded(settings)
      setApiKey('')
      setSubagentApiKey('')
      const modality = settings.capabilities.input.includes('image') ? '文字与图片' : '仅文字'
      const child = settings.subagent === undefined ? '子 Agent 跟随主模型' : `子 Agent 使用 ${settings.subagent.model}`
      setMessage({ kind: 'success', text: `已验收 ${settings.model}（${modality}）；${child}。新请求使用此配置。` })
      window.dispatchEvent(new Event('desktop-models-changed'))
      onSaved()
    } catch (error: unknown) {
      setMessage({ kind: 'error', text: publicError(error) })
    } finally {
      setSaving(false)
    }
  }

  const endpointChanged = (): void => {
    setLoaded(previous => previous === null ? null : {
      ...previous, capabilities: { input: ['text'], verified: false }, detectedCapabilities: { input: ['text'], verified: false },
    })
    setReasoning('')
    setRecheck(true)
  }

  const discover = async (): Promise<void> => {
    setSaving(true)
    try {
      const catalog = await window.dshDesktop.discoverModels({
        baseURL, model, apiKey, protocol,
        ...((initial.id ?? reuseKeyFrom) ? { id: initial.id ?? reuseKeyFrom } : {}),
      })
      setDirectory(catalog.models)
      if (!model && catalog.models[0]) setModel(catalog.models[0].id)
      setMessage({ kind: catalog.source === 'endpoint' ? 'success' : 'error', text: catalog.warning ?? `检测到 ${catalog.models.length} 个模型；保存时验证实际调用权限。` })
    } catch (error: unknown) { setMessage({ kind: 'error', text: publicError(error) }) }
    finally { setSaving(false) }
  }

  const detect = async (): Promise<void> => {
    setSaving(true)
    try {
      const capabilities = await window.dshDesktop.inspectModelSettings({
        id: initial.id, baseURL, model, protocol, apiKey, reuseKeyFrom: reuseKeyFrom || undefined, computerUseEnabled,
      })
      if (subagentConfigured) {
        await window.dshDesktop.inspectModelSettings({ baseURL: subagentBaseURL, model: subagentModel, protocol: subagentProtocol, apiKey: subagentApiKey }, 'subagent', initial.id)
      }
      setLoaded(previous => ({ ...(previous ?? initial), capabilities, detectedCapabilities: capabilities }))
      setRecheck(true)
      setMessage({ kind: 'success', text: '检测完成，手动设置已保留。' })
    } catch (error: unknown) { setMessage({ kind: 'error', text: publicError(error) }) }
    finally { setSaving(false) }
  }

  const beginSubagentEdit = (): void => {
    setSubagentConfigured(true)
  }

  const restoreSubagentInheritance = (): void => {
    setSubagentConfigured(false)
    setSubagentBaseURL('')
    setSubagentModel('')
    setSubagentProtocol('openai-completions')
    setSubagentApiKey('')
    setMessage(null)
  }

  const effectiveContext = context === '' ? loaded?.detectedCapabilities?.contextWindow : Number(context)
  const effectiveOutput = output === '' ? loaded?.detectedCapabilities?.maxOutputTokens : Number(output)
  const subagentReady = !subagentConfigured || (
    subagentBaseURL.trim() !== ''
    && subagentModel.trim() !== ''
    && (loaded?.subagent?.apiKeyConfigured === true || subagentApiKey.trim() !== '')
  )

  return (
    <section className={css.root} aria-labelledby="desktop-model-title">
      <button type="button" className={css.restoreInheritance} onClick={onBack}>‹ 返回模型列表</button>
      <header className={css.heading}>
        <span className={css.headingIcon}><DatabaseIcon /></span>
        <div>
          <div className={css.titleRow}>
            <h2 id="desktop-model-title">大模型 API</h2>
            <span className={css.primaryBadge}>主模型</span>
          </div>
          <p>配置 OpenAI 兼容接口。保存后对新请求生效，正在运行的任务继续使用原配置。</p>
        </div>
      </header>

      <div className={css.card}>
        <label className={css.field}><span>显示名称</span><input value={name} placeholder="例如 GLM 工作模型" onChange={(event) => { setName(event.target.value) }} /></label>
        <label className={css.field}>
          <span>API 协议</span>
          <select value={protocol} onChange={(event) => { setProtocol(event.target.value as DesktopModelProtocol); endpointChanged() }}>
            <option value="openai-completions">OpenAI Chat Completions</option>
            <option value="openai-responses">OpenAI Responses</option>
          </select>
        </label>

        <label className={css.computerUse}>
          <input type="checkbox" checked={computerUseEnabled} onChange={(event) => { setComputerUseEnabled(event.target.checked) }} />
          <span>
            <strong>允许 Computer Use</strong>
            <small>允许模型检查浏览器或 macOS 应用。每次截图、点击、输入、按键和滚动仍会单独请求批准；截图检查要求主模型支持图片输入，macOS 还需为应用开启屏幕录制权限。</small>
          </span>
        </label>

        {loaded?.capabilities.verified === true && (
          <p className={css.status} data-kind="success">
            已验证文字、工具调用与所选协议；图片输入：{loaded.capabilities.input.includes('image') ? '支持' : '不支持'}
            {effectiveContext === undefined ? '' : `；有效上下文：${effectiveContext.toLocaleString()} tokens`}
            {effectiveOutput === undefined ? '' : `；有效最大输出：${effectiveOutput.toLocaleString()} tokens`}
          </p>
        )}

        <label className={css.field}>
          <span>Base URL</span>
          <input
            type="url"
            value={baseURL}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            onChange={(event) => { setBaseURL(event.target.value); endpointChanged() }}
          />
        </label>

        <label className={css.field}>
          <span>模型 ID</span>
          <input
            value={model}
            list="desktop-model-directory"
            placeholder="例如 gpt-5.2、qwen3-coder"
            spellCheck={false}
            onChange={(event) => { setModel(event.target.value); endpointChanged() }}
          />
        </label>

        <datalist id="desktop-model-directory">{directory.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist>
        <button type="button" disabled={saving || !baseURL} className={css.restoreInheritance} onClick={() => { void discover() }}>检测模型目录</button>

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

        {!initial.apiKeyConfigured && <label className={css.field}><span>复用已保存的 API Key</span>
          <select value={reuseKeyFrom} onChange={(event) => { setReuseKeyFrom(event.target.value) }}>
            <option value="">使用上方输入的密钥</option>
            {profiles.filter(profile => profile.baseURL === baseURL && profile.protocol === protocol).map(profile => (
              <option key={profile.id} value={profile.id}>{profile.name || profile.model}</option>
            ))}
          </select></label>}
        <button type="button" disabled={saving || !baseURL || !model || (!initial.apiKeyConfigured && !apiKey && !reuseKeyFrom)} className={css.restoreInheritance}
          onClick={() => { void detect() }}>重新检测能力</button>
        <label className={css.field}><span>整个上下文窗口（tokens，包含输入和输出）</span>
          <input type="number" min="1" step="1" value={context} placeholder={String(loaded?.detectedCapabilities?.contextWindow ?? '自动；未知时必须填写')} onChange={(event) => { setContext(event.target.value) }} />
          <small>{context ? '来源：手动设置' : `来源：${loaded?.detectedCapabilities?.contextSource === 'interface' ? '接口返回' : loaded?.detectedCapabilities?.contextSource === 'catalog' ? '模型资料' : '未知'}`}</small></label>
        <label className={css.field}><span>最大输出（tokens）</span>
          <input type="number" min="1" step="1" value={output} placeholder={String(loaded?.detectedCapabilities?.maxOutputTokens ?? '使用提供商默认值')} onChange={(event) => { setOutput(event.target.value) }} />
          <small>{output ? '来源：手动设置' : `来源：${loaded?.detectedCapabilities?.outputSource === 'interface' ? '接口返回' : loaded?.detectedCapabilities?.outputSource === 'catalog' ? '模型资料' : '提供商默认值（未知）'}`}</small></label>
        <label className={css.field}><span>默认思考强度</span>
          <select value={reasoning} onChange={(event) => { setReasoning(event.target.value as DesktopReasoningLevel | '') }}>
            <option value="">自动（使用提供商默认值）</option>
            {Object.keys(loaded?.detectedCapabilities?.reasoningEfforts ?? {}).map(level => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select><small>{Object.keys(loaded?.detectedCapabilities?.reasoningEfforts ?? {}).length ? '仅列出已声明支持的强度。' : '接口未声明可调思考强度，仅使用自动。'}</small></label>
        <button type="button" className={css.restoreInheritance} onClick={() => { setContext(''); setOutput(''); setReasoning('') }}>恢复自动参数</button>
        <div className={css.subagentSection}>
          <button
            type="button"
            className={css.subagentDisclosure}
            aria-expanded={subagentExpanded}
            aria-controls="desktop-subagent-model-fields"
            onClick={() => { setSubagentExpanded(open => !open) }}
          >
            <span>{subagentExpanded ? '⌃' : '⌄'} 配置单独子agent</span>
            <small>{subagentConfigured ? '已启用单独模型' : '未配置时自动使用主模型'}</small>
          </button>

          {subagentExpanded && (
            <div id="desktop-subagent-model-fields" className={css.subagentFields}>
              <div className={css.subagentHeading}>
                <div>
                  <strong>子 Agent 模型</strong>
                  <small>新创建的子 Agent 使用这里的模型；主 Agent 保持使用上方配置。</small>
                </div>
                <span className={css.subagentBadge}>子 Agent</span>
              </div>

              <label className={css.field}>
                <span>API 协议</span>
                <select
                  value={subagentProtocol}
                  onChange={(event) => {
                    beginSubagentEdit()
                    setSubagentProtocol(event.target.value as DesktopModelProtocol)
                  }}
                >
                  <option value="openai-completions">OpenAI Chat Completions</option>
                  <option value="openai-responses">OpenAI Responses</option>
                </select>
              </label>

              <label className={css.field}>
                <span>Base URL</span>
                <input
                  type="url"
                  value={subagentBaseURL}
                  placeholder="https://api.deepseek.com/v1"
                  spellCheck={false}
                  onChange={(event) => {
                    beginSubagentEdit()
                    setSubagentBaseURL(event.target.value)
                  }}
                />
              </label>

              <label className={css.field}>
                <span>模型 ID</span>
                <input
                  value={subagentModel}
                  placeholder="例如 deepseek-chat"
                  spellCheck={false}
                  onChange={(event) => {
                    beginSubagentEdit()
                    setSubagentModel(event.target.value)
                  }}
                />
              </label>

              <label className={css.field}>
                <span className={css.keyLabel}><KeyIcon /> API Key</span>
                <input
                  type="password"
                  value={subagentApiKey}
                  autoComplete="off"
                  placeholder={loaded?.subagent?.apiKeyConfigured === true ? '已安全保存；留空表示不修改' : '输入子 Agent API Key'}
                  onChange={(event) => {
                    beginSubagentEdit()
                    setSubagentApiKey(event.target.value)
                  }}
                />
                <small>单独加密保存，不会发送给主模型或显示在会话记录中。</small>
              </label>

              <label className={css.field}><span>子 Agent 整个上下文窗口（tokens）</span><input type="number" min="1" step="1" value={childContext} placeholder={String(initial.subagent?.capabilities.contextWindow ?? '自动；未知时必须填写')} onChange={(event) => { setChildContext(event.target.value) }} /></label>
              <label className={css.field}><span>子 Agent 最大输出（tokens）</span><input type="number" min="1" step="1" value={childOutput} placeholder="使用提供商默认值" onChange={(event) => { setChildOutput(event.target.value) }} /></label>
              {subagentConfigured && (
                <button type="button" className={css.restoreInheritance} onClick={restoreSubagentInheritance}>
                  恢复跟随主 Agent
                </button>
              )}
            </div>
          )}
        </div>

        <div className={css.footer}>
          <div className={css.status} aria-live="polite" data-kind={message?.kind}>
            {loaded === null && message === null ? '正在读取配置…' : message?.text}
          </div>
          <button
            type="button"
            className={css.save}
            disabled={saving || loaded === null || baseURL.trim() === '' || model.trim() === '' || (!loaded.apiKeyConfigured && apiKey.trim() === '' && reuseKeyFrom === '') || !subagentReady}
            onClick={() => { void save() }}
          >
            {saving ? '正在应用…' : '保存模型'}
          </button>
        </div>
      </div>
    </section>
  )
}

/** Saved model list and per-model endpoint editor; keys remain in Electron Main. */
export function DesktopModelSettingsSection() {
  const [catalog, setCatalog] = useState<{ profiles: DesktopModelSettings[]; defaultId?: string }>({ profiles: [] })
  const [editing, setEditing] = useState<DesktopModelSettings | null>(null)
  const [error, setError] = useState('')
  const refresh = (): void => {
    void window.dshDesktop.modelProfiles().then(setCatalog).catch((failure: unknown) => { setError(publicError(failure)) })
  }
  const updateSelection = (id: string | undefined, remove: boolean): void => {
    if (id === undefined) throw new Error('模型列表缺少配置标识')
    const operation = remove ? window.dshDesktop.removeModel(id) : window.dshDesktop.selectProfile(id)
    void operation.then(() => { window.dispatchEvent(new Event('desktop-models-changed')) })
      .catch((failure: unknown) => { setError(publicError(failure)) })
  }
  useEffect(() => { refresh(); window.addEventListener('desktop-models-changed', refresh); return () => { window.removeEventListener('desktop-models-changed', refresh) } }, [])
  if (editing !== null) return <ModelEditor initial={editing} profiles={catalog.profiles}
    onBack={() => { setEditing(null) }} onSaved={() => { setEditing(null); refresh() }} />
  return <section className={css.root} aria-label="模型列表">
    <header className={css.heading}><span className={css.headingIcon}><DatabaseIcon /></span>
      <div><h2>模型 API</h2><p>管理已配置模型。输入框可以选择下一轮使用的模型。</p></div>
    </header>
    {catalog.profiles.map(profile => <div className={css.card} key={profile.id}>
      <div className={css.titleRow}><strong>{profile.name || profile.model}</strong>
        {catalog.defaultId === profile.id && <span className={css.primaryBadge}>默认</span>}
      </div>
      <p className={css.status}>{profile.model} · {profile.protocol} · {profile.capabilities.contextWindow?.toLocaleString() ?? '未知'} tokens · {profile.overrides?.reasoning ?? '自动思考'}</p>
      <div className={css.footer}>
        <button type="button" className={css.restoreInheritance} onClick={() => { setEditing(profile) }}>编辑配置</button>
        <button type="button" className={css.restoreInheritance} disabled={profile.id === catalog.defaultId} onClick={() => { updateSelection(profile.id, false) }}>设为默认</button>
        <button type="button" className={css.restoreInheritance} onClick={() => { updateSelection(profile.id, true) }}>删除配置</button>
      </div></div>)}
    <button type="button" className={css.save} onClick={() => { setEditing({ configured: false, baseURL: 'https://api.openai.com/v1', model: '', protocol: 'openai-completions', apiKeyConfigured: false, computerUseEnabled: false, capabilities: { input: ['text'], verified: false } }) }}>新增模型</button>
    {error && <p role="alert" className={css.status} data-kind="error">{error}</p>}
  </section>
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
