import { useCallback, useEffect, useState } from 'react'
import type { AgentContext, ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerServiceContract, InputTriggerSource, ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { IConversation, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DesktopAttachment, DesktopSkillSummary } from './shared.ts'
import { producedForClosing } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { desktopAttachmentMarker, desktopAttachmentReference } from './desktop-prompt.ts'
import css from './desktop-content-ui.module.css'

/** Session services the Desktop-owned content UI needs from the product adapter. */
export interface DesktopContentSessions {
  /** Return the Session currently owning the composer, when one exists. */
  currentSessionId(): SessionId | undefined
  currentCwd(): string
  cwd(sessionId: SessionId): string | undefined
  scope(sessionId: SessionId): AgentContext | undefined
  /** Open one generated artifact in the owned browser/preview panel. */
  openArtifact(path: string): Promise<void>
}

function attachmentReference(attachment: DesktopAttachment): ReferenceInsert {
  return {
    source: 'attachment',
    ref: desktopAttachmentReference(attachment),
    label: attachment.name,
    appearance: attachment.kind === 'directory' ? 'folder' : 'file',
    clipboardText: attachment.path,
  }
}

interface AttachmentTarget {
  readonly input: ReturnType<IConversation['input']['for']>
  readonly span: TokenSpan
}

function attachmentTarget(
  sessions: DesktopContentSessions,
  sessionId: SessionId,
  span: TokenSpan,
): AttachmentTarget | undefined {
  const scope = sessions.scope(sessionId)
  if (scope === undefined) return undefined
  const conversation = scope.get('conversation')
  if (conversation === undefined) return undefined
  const input = conversation.input.for(scope)
  const state = input.state.getSnapshot()
  if (span.draftRev !== state.draftRev || span.start > state.draft.length || span.end > state.draft.length) return undefined
  return { input, span }
}

function discardAttachments(sessionId: SessionId, attachments: readonly DesktopAttachment[]): void {
  for (const attachment of attachments) void window.dshDesktop.removeAttachment(sessionId, attachment.id)
}

function insertAttachments(
  target: AttachmentTarget,
  attachments: readonly DesktopAttachment[],
): boolean {
  let span = target.span
  for (const attachment of attachments) {
    const reference = attachmentReference(attachment)
    if (!target.input.insertReference(reference, span)) return false
    const state = target.input.state.getSnapshot()
    const occurrence = state.occurrences.find(item => item.ref === reference.ref && item.source === 'attachment')
    if (occurrence === undefined) return false
    const offset = occurrence.offset + occurrence.length
    span = { start: offset, end: offset, draftRev: state.draftRev }
  }
  return true
}

function SkillIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M9 3h6v4h4v6h-4v4H9v-4H5V7h4z" /><path d="M9 9h6v6H9z" /></svg>
}

function SkillsSettings({ cwd }: { cwd: string }) {
  const [rows, setRows] = useState<readonly DesktopSkillSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const refresh = useCallback(async () => {
    setRows(await window.dshDesktop.listSkills(cwd))
  }, [cwd])
  useEffect(() => { void refresh().catch((error: unknown) => { setMessage(String(error)) }) }, [refresh])
  const importSkill = async (): Promise<void> => {
    setBusy(true); setMessage('')
    try {
      const added = await window.dshDesktop.importSkill()
      if (added !== null) { setMessage(`已导入 ${added.name}`); await refresh() }
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return (
    <section className={css.settings} aria-labelledby="desktop-skills-title">
      <header className={css.settingsHeader}>
        <span className={css.settingsIcon}><SkillIcon /></span>
        <div><h2 id="desktop-skills-title">Skills</h2><p>管理用户 Skills。项目和内置 Skills 只读，并会按任务需要调用。</p></div>
        <button type="button" disabled={busy} onClick={() => { void importSkill() }}>{busy ? '正在导入…' : '导入 Skill'}</button>
      </header>
      {message !== '' && <div className={css.message} role="status">{message}</div>}
      <div className={css.skillList}>
        {rows.map(row => (
          <div className={css.skillRow} key={`${row.source}:${row.name}`}>
            <SkillIcon />
            <div><strong>{row.name}</strong><span>{row.description}</span></div>
            <em>{row.source === 'user' ? '用户' : row.source === 'project' ? '项目' : '内置'}</em>
            {row.removable && <button type="button" onClick={() => {
              if (!window.confirm(`删除 Skill “${row.name}”？`)) return
              void window.dshDesktop.removeSkill(row.name).then(refresh).catch((error: unknown) => { setMessage(String(error)) })
            }}>删除</button>}
          </div>
        ))}
      </div>
    </section>
  )
}

type ArtifactActionsProps = TurnTailOwnerProps & {
  matched: readonly string[]
  sessionId: SessionId
  sessions: DesktopContentSessions
}

type ArtifactMenu = { readonly path: string; readonly kind: 'open' | 'context'; readonly x?: number; readonly y?: number }

function artifactName(path: string): string {
  return path.replaceAll('\\', '/').split('/').pop() ?? path
}

function artifactFolder(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const index = normalized.lastIndexOf('/')
  return index > 0 ? normalized.slice(0, index) : path
}

function artifactKind(path: string): string {
  const extension = artifactName(path).split('.').pop()?.toLowerCase()
  if (extension === 'docx') return '文档 · DOCX'
  if (extension === 'xlsx' || extension === 'xls') return '表格 · XLSX'
  if (extension === 'pptx' || extension === 'ppt') return '演示文稿 · PPTX'
  if (extension === 'pdf') return '文档 · PDF'
  if (extension === 'html' || extension === 'htm') return '网页 · HTML'
  if (extension === 'csv' || extension === 'tsv') return '数据 · CSV'
  return `${extension?.toUpperCase() ?? 'FILE'} 文件`
}

function ArtifactFileIcon({ path }: { path: string }) {
  const extension = artifactName(path).split('.').pop()?.toUpperCase() ?? 'FILE'
  return <span className={css.artifactFileIcon} aria-hidden><svg viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg><small>{extension.slice(0, 4)}</small></span>
}

function ArtifactActions({ matched, sessionId, sessions }: ArtifactActionsProps) {
  const [message, setMessage] = useState('')
  const [menu, setMenu] = useState<ArtifactMenu | null>(null)
  const reportError = (error: unknown): void => {
    setMessage(error instanceof Error ? error.message : String(error))
  }
  useEffect(() => {
    if (menu === null) return undefined
    const dismiss = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest(`.${css.artifactMenu}`) !== null) return
      setMenu(null)
    }
    const dismissOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismissOnEscape) }
  }, [menu])
  const addToChat = async (path: string): Promise<void> => {
    const cwd = sessions.cwd(sessionId)
    const scope = sessions.scope(sessionId)
    const conversation = scope?.get('conversation')
    if (cwd === undefined || scope === undefined || conversation === undefined) throw new Error('当前对话不可添加产物')
    const input = conversation.input.for(scope)
    const state = input.state.getSnapshot()
    const target = attachmentTarget(sessions, sessionId, {
      start: state.draft.length, end: state.draft.length, draftRev: state.draftRev,
    })
    if (target === undefined) throw new Error('输入内容已变更，请重试')
    const added = await window.dshDesktop.referenceAttachments(sessionId, cwd, [path])
    if (insertAttachments(target, added)) { setMessage(`已添加 ${artifactName(path)} 到聊天`); return }
    discardAttachments(sessionId, added)
    throw new Error('附件未插入：输入内容已变更，请重试')
  }
  const runMenuAction = (action: 'system' | 'folder' | 'chat' | 'copy' | 'preview', path: string): void => {
    setMenu(null)
    const run = action === 'system'
      ? window.dshDesktop.openPath(path)
      : action === 'folder'
        ? window.dshDesktop.openPath(artifactFolder(path))
        : action === 'chat'
          ? addToChat(path)
          : action === 'copy'
            ? navigator.clipboard.writeText(path).then(() => { setMessage('已复制产物路径') })
            : sessions.openArtifact(path)
    void run.catch(reportError)
  }
  return (
    <section className={css.artifactActions} aria-label="本轮产物">
      <div className={css.artifactList}>
        {matched.map(path => (
          <div className={css.artifactRow} key={path} role="button" tabIndex={0} onClick={() => { void sessions.openArtifact(path).catch(reportError) }} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void sessions.openArtifact(path).catch(reportError) }
          }} onContextMenu={(event) => {
            event.preventDefault()
            setMenu({ kind: 'context', path, x: event.clientX, y: event.clientY })
          }}>
            <ArtifactFileIcon path={path} />
            <div className={css.artifactDetails}><strong>{artifactName(path)}</strong><span>{artifactKind(path)}</span></div>
            <button type="button" className={css.openWithButton} onClick={(event) => { event.stopPropagation(); setMenu({ kind: 'open', path }) }}>打开方式 <span aria-hidden>⌄</span></button>
            {menu?.path === path && menu.kind === 'open' && <div className={css.artifactMenu} role="menu">
              <button type="button" role="menuitem" onClick={() => { runMenuAction('system', path) }}>用系统默认应用打开</button>
              <button type="button" role="menuitem" onClick={() => { runMenuAction('preview', path) }}>在预览栏中打开</button>
              <button type="button" role="menuitem" onClick={() => { runMenuAction('folder', path) }}>在 Finder 中显示</button>
            </div>}
          </div>
        ))}
      </div>
      {menu?.kind === 'context' && <div className={`${css.artifactMenu} ${css.contextMenu}`} role="menu" style={{ left: menu.x, top: menu.y }}>
        <button type="button" role="menuitem" onClick={() => { runMenuAction('folder', menu.path) }}>打开文件位置</button>
        <button type="button" role="menuitem" onClick={() => { runMenuAction('chat', menu.path) }}>添加到聊天</button>
        <button type="button" role="menuitem" onClick={() => { runMenuAction('copy', menu.path) }}>复制路径</button>
      </div>}
      <div className={css.artifactFooter}>
        <button type="button" onClick={() => { void window.dshDesktop.exportArtifacts(sessionId)
          .then((path) => { if (path !== null) setMessage(`已导出到 ${path}`) })
          .catch(reportError) }}>导出全部 ZIP</button>
        <span>{matched.length} 个产物</span>
      </div>
      {message !== '' && <span role="status">{message}</span>}
    </section>
  )
}

/** Build the Desktop content plugin around the already-owned Session adapter. */
export function desktopContentPlugin(sessions: DesktopContentSessions) {
  return {
    inject: ['slots', 'inputTriggers'] as const,
    apply(ctx: ClientContext) {
      const catalogs = new Map<SessionId, readonly DesktopSkillSummary[]>()
      const catalogListeners = new Map<SessionId, Set<() => void>>()
      const load = async (sessionId: SessionId, refresh = false): Promise<readonly DesktopSkillSummary[]> => {
        const existing = catalogs.get(sessionId)
        if (!refresh && existing !== undefined) return existing
        const cwd = sessions.cwd(sessionId)
        if (cwd === undefined) return []
        const rows = await window.dshDesktop.listSkills(cwd)
        catalogs.set(sessionId, rows)
        for (const listener of [...(catalogListeners.get(sessionId) ?? [])]) listener()
        return rows
      }
      const source: InputTriggerSource = {
        trigger: '/', name: 'command', showGroupTitle: false,
        async candidates(session, { query }) {
          const rows = await load(session.sessionId, true)
          const actions = query === '' || 'attachment'.startsWith(query)
            ? [{ name: '上传附件', description: '添加图片或普通文件', icon: 'paperclip', value: 'attachment' }]
            : []
          return [
            ...actions,
            ...rows.filter(row => row.name.startsWith(query)).map(row => ({
              name: row.name,
              description: row.description,
              icon: 'skill',
              submenu: 'Skills',
              value: `skill:${row.name}`,
            })),
          ]
        },
        warm(session) { void load(session.sessionId) },
        lexicon(session) { return catalogs.get(session.sessionId)?.map(row => row.name) },
        subscribeLexicon(session, listener) {
          const set = catalogListeners.get(session.sessionId) ?? new Set<() => void>()
          set.add(listener)
          catalogListeners.set(session.sessionId, set)
          return () => {
            set.delete(listener)
            if (set.size === 0) catalogListeners.delete(session.sessionId)
          }
        },
        onPick({ candidate, session, span }) {
          if (candidate.value !== 'attachment') {
            return {
              insert: {
                source: 'command',
                ref: candidate.name,
                label: candidate.name,
                appearance: 'skill',
                clipboardText: `/${candidate.name}`,
              },
            }
          }
          const cwd = sessions.cwd(session.sessionId)
          const target = attachmentTarget(sessions, session.sessionId, span)
          if (cwd === undefined || target === undefined) return 'handled'
          void window.dshDesktop.pickAttachments(session.sessionId, cwd)
            .then((added) => {
              if (insertAttachments(target, added)) return
              discardAttachments(session.sessionId, added)
              target.input.notify('error', '附件未插入：输入内容已变更，请重新选择。')
            })
            .catch((error: unknown) => {
              target.input.notify('error', error instanceof Error ? error.message : String(error))
            })
          return 'handled'
        },
        codec: {
          clipboardText(ref) { return `/${ref}` },
          serialize(ref) { return Promise.resolve(`<skill>${ref}</skill>`) },
        },
      }
      const attachmentSource: InputTriggerSource = {
        trigger: '@', name: 'attachment', showGroupTitle: false,
        candidates() { return Promise.resolve([]) },
        onPick() { return undefined },
        codec: {
          clipboardText(ref) { return ref },
          serialize(ref) { return Promise.resolve(desktopAttachmentMarker(ref)) },
        },
      }
      ctx.effect(() => {
        const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
        const unregisterCommand = inputTriggers.registerSource(source)
        const unregisterAttachment = inputTriggers.registerSource(attachmentSource)
        return () => { unregisterAttachment(); unregisterCommand() }
      }, 'desktop-content: input references')
      ctx.effect(() => window.dshDesktop.subscribeAttachmentPaste((paste) => {
        const sessionId = sessions.currentSessionId()
        if (sessionId === undefined) return
        const cwd = sessions.cwd(sessionId)
        if (cwd === undefined) return
        const scope = sessions.scope(sessionId)
        if (scope === undefined) return
        const conversation = scope.get('conversation')
        if (conversation === undefined) return
        const input = conversation.input.for(scope)
        const target = attachmentTarget(sessions, sessionId, {
          ...paste.selection,
          draftRev: input.state.getSnapshot().draftRev,
        })
        if (target === undefined) return
        void window.dshDesktop.pasteAttachments(sessionId, cwd, paste)
          .then((added) => {
            if (insertAttachments(target, added)) return
            discardAttachments(sessionId, added)
            target.input.notify('error', '附件未插入：输入内容已变更，请重新粘贴。')
          })
          .catch((error: unknown) => {
            target.input.notify('error', error instanceof Error ? error.message : String(error))
          })
      }), 'desktop-content: native attachment paste')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'skills', order: 20, label: 'Skills',
      }, () => <SkillsSettings cwd={sessions.currentCwd()} />))
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        select: (owner: TurnTailOwnerProps) => {
          const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
          return paths.length === 0 ? null : paths
        },
      }, props => <ArtifactActions {...props} sessions={sessions} />))
    },
  }
}
