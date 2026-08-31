import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopAttachment, DesktopSkillSummary } from './shared.ts'
import { producedForClosing } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import css from './desktop-content-ui.module.css'

/** Session services the Desktop-owned content UI needs from the product adapter. */
export interface DesktopContentSessions {
  currentCwd(): string
  cwd(sessionId: SessionId): string | undefined
}

const pending = new Map<string, readonly DesktopAttachment[]>()
const listeners = new Map<string, Set<() => void>>()
const EMPTY_ATTACHMENTS: readonly DesktopAttachment[] = []

function publish(sessionId: string): void {
  for (const listener of [...(listeners.get(sessionId) ?? [])]) listener()
}

function subscribe(sessionId: string, listener: () => void): () => void {
  const set = listeners.get(sessionId) ?? new Set<() => void>()
  set.add(listener)
  listeners.set(sessionId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(sessionId)
  }
}

/** Attachment ids selected for the next Desktop prompt. */
export function pendingAttachmentIds(sessionId: string): readonly string[] {
  return (pending.get(sessionId) ?? EMPTY_ATTACHMENTS).map(item => item.id)
}

/** Clear attachments only after the ACP prompt accepted them. */
export function clearPendingAttachments(sessionId: string): void {
  pending.delete(sessionId)
  publish(sessionId)
}

function AttachmentIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><path d="m8 12 5.7-5.7a3 3 0 0 1 4.3 4.2l-7.8 7.8a5 5 0 0 1-7.1-7.1l8-8" /></svg>
}

function SkillIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M9 3h6v4h4v6h-4v4H9v-4H5V7h4z" /><path d="M9 9h6v6H9z" /></svg>
}

function PendingAttachments({ sessionId }: { sessionId: string }) {
  const rows = useSyncExternalStore(
    listener => subscribe(sessionId, listener),
    () => pending.get(sessionId) ?? EMPTY_ATTACHMENTS,
    () => EMPTY_ATTACHMENTS,
  )
  if (rows.length === 0) return null
  return (
    <div className={css.attachmentRail} aria-label="待发送附件">
      {rows.map(row => (
        <span className={css.attachmentChip} key={row.id} title={row.path}>
          <AttachmentIcon />
          <span>{row.name}</span>
          <button type="button" aria-label={`移除 ${row.name}`} onClick={() => {
            pending.set(sessionId, rows.filter(item => item.id !== row.id))
            publish(sessionId)
            void window.dshDesktop.removeAttachment(sessionId, row.id)
          }}>×</button>
        </span>
      ))}
    </div>
  )
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

type ArtifactActionsProps = TurnTailOwnerProps & { matched: readonly string[]; sessionId: string }

function ArtifactActions({ matched, sessionId }: ArtifactActionsProps) {
  const [message, setMessage] = useState('')
  const selectId = useId()
  const reportError = (error: unknown): void => {
    setMessage(error instanceof Error ? error.message : String(error))
  }
  return (
    <div className={css.artifactActions}>
      <select aria-label="选择要另存的产物" defaultValue={matched[0]} id={selectId}>
        {matched.map(path => <option key={path} value={path}>{path.split('/').pop()}</option>)}
      </select>
      <button type="button" onClick={() => {
        const select = document.getElementById(selectId) as HTMLSelectElement | null
        if (select !== null) void window.dshDesktop.saveArtifact(sessionId, select.value)
          .then((path) => { if (path !== null) setMessage(`已保存到 ${path}`) })
          .catch(reportError)
      }}>单文件另存为</button>
      <button type="button" onClick={() => { void window.dshDesktop.exportArtifacts(sessionId)
        .then((path) => { if (path !== null) setMessage(`已导出到 ${path}`) })
        .catch(reportError) }}>全部 ZIP 导出</button>
      {message !== '' && <span role="status">{message}</span>}
    </div>
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
        onPick({ candidate, session }) {
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
          if (cwd === undefined) return 'handled'
          void window.dshDesktop.pickAttachments(session.sessionId, cwd).then((added) => {
            if (added.length === 0) return
            pending.set(session.sessionId, [...(pending.get(session.sessionId) ?? []), ...added])
            publish(session.sessionId)
          })
          return 'handled'
        },
        codec: {
          clipboardText(ref) { return `/${ref}` },
          serialize(ref) { return Promise.resolve(`/${ref}`) },
        },
      }
      ctx.effect(() => (ctx.get('inputTriggers') as InputTriggerServiceContract).registerSource(source), 'desktop-content: launcher')
      ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
        name: 'conversation.input.attachments',
      }, ({ sessionId }: PropsRuntime<'conversation.input.attachments'>) => sessionId === undefined ? null : <PendingAttachments sessionId={sessionId} />))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'skills', order: 20, label: 'Skills',
      }, () => <SkillsSettings cwd={sessions.currentCwd()} />))
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        select: (owner: TurnTailOwnerProps) => {
          const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
          return paths.length === 0 ? null : paths
        },
      }, ArtifactActions))
    },
  }
}
