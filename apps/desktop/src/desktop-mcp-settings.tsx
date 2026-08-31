import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopMcpServerSummary, DesktopMcpServerUpdate, DesktopMcpTransport } from './shared.ts'
import css from './desktop-mcp-settings.module.css'

/** Required client services for the Desktop-owned MCP settings section. */
export const inject = ['slots']

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path d="M9.5 14.5 14.5 9" />
      <path d="m7.2 17.8-1.4 1.4a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0" transform="translate(2 0)" />
      <path d="m16.8 6.2 1.4-1.4a4.2 4.2 0 1 1 6 6l-4 4a4.2 4.2 0 0 1-6 0" transform="translate(-2 0)" />
    </svg>
  )
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseSecrets(text: string): Record<string, string> | undefined {
  if (text.trim() === '') return undefined
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('凭据必须是 JSON 对象')
  const entries = Object.entries(value)
  if (!entries.every(([, entry]) => typeof entry === 'string')) throw new Error('凭据的每个值都必须是字符串')
  return Object.fromEntries(entries)
}

/** Desktop MCP server editor backed by the Main-owned private JSON document. */
export function DesktopMcpSettingsSection() {
  const [servers, setServers] = useState<DesktopMcpServerSummary[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [serverName, setServerName] = useState('')
  const [transport, setTransport] = useState<DesktopMcpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [cwd, setCwd] = useState('')
  const [url, setUrl] = useState('')
  const [secretsText, setSecretsText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    void window.dshDesktop.listMcpServers().then((rows) => {
      if (live) setServers(rows)
    }).catch((error: unknown) => {
      if (live) setMessage({ kind: 'error', text: publicError(error) })
    })
    return () => { live = false }
  }, [])

  const reset = (): void => {
    setEditing(null)
    setServerName('')
    setTransport('stdio')
    setCommand('')
    setArgsText('')
    setCwd('')
    setUrl('')
    setSecretsText('')
  }

  const beginCreate = (): void => {
    reset()
    setOpen(true)
    setMessage(null)
  }

  const beginEdit = (server: DesktopMcpServerSummary): void => {
    setEditing(server.serverName)
    setServerName(server.serverName)
    setTransport(server.transport)
    setCommand(server.command ?? '')
    setArgsText((server.args ?? []).join('\n'))
    setCwd(server.cwd ?? '')
    setUrl(server.url ?? '')
    setSecretsText('')
    setOpen(true)
    setMessage(null)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const secrets = parseSecrets(secretsText)
      const update: DesktopMcpServerUpdate = {
        serverName: serverName.trim(), transport,
        ...(transport === 'stdio'
          ? { command: command.trim(), args: argsText.split('\n').map(value => value.trim()).filter(Boolean), cwd: cwd.trim() }
          : { url: url.trim() }),
        ...(secrets === undefined ? {} : { secrets }),
      }
      setServers(await window.dshDesktop.saveMcpServer(update))
      setOpen(false)
      reset()
      setMessage({ kind: 'success', text: `MCP 服务器 ${update.serverName} 已保存并连接。` })
    } catch (error: unknown) {
      setMessage({ kind: 'error', text: publicError(error) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      setServers(await window.dshDesktop.removeMcpServer(name))
      if (editing === name) {
        setOpen(false)
        reset()
      }
      setMessage({ kind: 'success', text: `MCP 服务器 ${name} 已移除。` })
    } catch (error: unknown) {
      setMessage({ kind: 'error', text: publicError(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={css.root} aria-labelledby="desktop-mcp-title">
      <header className={css.heading}>
        <span className={css.headingIcon}><LinkIcon /></span>
        <div className={css.headingCopy}>
          <h2 id="desktop-mcp-title">MCP</h2>
          <p>连接本地 stdio 或 Streamable HTTP 服务器。保存后，其工具会出现在当前 Agent 和后续会话中。</p>
        </div>
        <button type="button" className={css.add} onClick={beginCreate}>添加服务器</button>
      </header>

      <div className={css.list} aria-live="polite">
        {servers === null && <div className={css.empty}>正在读取配置…</div>}
        {servers?.length === 0 && <div className={css.empty}>尚未配置 MCP 服务器。你也可以直接告诉 Agent“帮我配置这个 MCP”。</div>}
        {servers?.map(server => (
          <article className={css.server} key={server.serverName}>
            <div className={css.serverCopy}>
              <div className={css.serverTitle}>
                <strong>{server.serverName}</strong>
                <span>{server.transport === 'stdio' ? 'stdio' : 'HTTP'}</span>
              </div>
              <code>{server.target}</code>
              {server.secretNames.length > 0 && <small>已保存凭据：{server.secretNames.join('、')}</small>}
            </div>
            <div className={css.actions}>
              <button type="button" disabled={busy} onClick={() => { beginEdit(server) }}>编辑</button>
              <button type="button" className={css.remove} disabled={busy} onClick={() => { void remove(server.serverName) }}>删除</button>
            </div>
          </article>
        ))}
      </div>

      {open && (
        <div className={css.editor}>
          <div className={css.grid}>
            <label className={css.field}>
              <span>名称</span>
              <input value={serverName} disabled={editing !== null} placeholder="例如 github" spellCheck={false} onChange={(event) => { setServerName(event.target.value) }} />
              <small>用于工具前缀 mcp__名称__工具。</small>
            </label>
            <label className={css.field}>
              <span>连接方式</span>
              <select value={transport} onChange={(event) => { setTransport(event.target.value as DesktopMcpTransport); setSecretsText('') }}>
                <option value="stdio">本地命令（stdio）</option>
                <option value="streamable-http">Streamable HTTP</option>
              </select>
            </label>
          </div>

          {transport === 'stdio' ? (
            <>
              <label className={css.field}>
                <span>启动命令</span>
                <input value={command} placeholder="例如 npx" spellCheck={false} onChange={(event) => { setCommand(event.target.value) }} />
              </label>
              <label className={css.field}>
                <span>参数（每行一个）</span>
                <textarea value={argsText} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/miao'} spellCheck={false} onChange={(event) => { setArgsText(event.target.value) }} />
              </label>
              <label className={css.field}>
                <span>工作目录（可选）</span>
                <input value={cwd} placeholder="留空使用 Runtime 工作目录" spellCheck={false} onChange={(event) => { setCwd(event.target.value) }} />
              </label>
            </>
          ) : (
            <label className={css.field}>
              <span>MCP URL</span>
              <input type="url" value={url} placeholder="https://example.com/mcp" spellCheck={false} onChange={(event) => { setUrl(event.target.value) }} />
            </label>
          )}

          <label className={css.field}>
            <span>{transport === 'stdio' ? '环境变量 JSON（可选）' : 'HTTP Headers JSON（可选）'}</span>
            <textarea
              className={css.secret}
              value={secretsText}
              placeholder={editing === null ? '{"TOKEN":"..."}' : '留空保留当前凭据；输入 {} 可清空'}
              spellCheck={false}
              onChange={(event) => { setSecretsText(event.target.value) }}
            />
            <small>凭据只写入本机 owner-only 配置文件，不会回传到 Renderer 列表。</small>
          </label>

          <div className={css.editorFooter}>
            <button type="button" className={css.cancel} disabled={busy} onClick={() => { setOpen(false); reset() }}>取消</button>
            <button
              type="button"
              className={css.save}
              disabled={busy || serverName.trim() === '' || (transport === 'stdio' ? command.trim() === '' : url.trim() === '')}
              onClick={() => { void save() }}
            >
              {busy ? '正在连接…' : '保存并连接'}
            </button>
          </div>
        </div>
      )}

      {message !== null && <div className={css.status} data-kind={message.kind}>{message.text}</div>}
    </section>
  )
}

/** Register the Desktop MCP section into the shared Settings shell. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'mcp', order: 20, label: 'MCP',
  }, DesktopMcpSettingsSection))
}
