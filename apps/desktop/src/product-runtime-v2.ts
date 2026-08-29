import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type {
  ContentBlock, DirectoryListing, RpcResult, SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  ConversationEventRegistry,
  ConversationNodeAssembler,
  ConversationViewRegistry,
  EMPTY_CHAT_SNAPSHOT,
  SessionProvideChannel,
  SlotRegistry,
  createScope,
  createSnapshotStore,
  scopeOf,
  type AgentContext,
  type ConversationSnapshot,
  type ISessions,
  type IWorkspaces,
  type ProjectionsFace,
  type SessionBinding,
  type SessionFace,
  type SessionListState,
  type SessionProvideDescriptor,
  type SessionSummary,
  type SettingsScope,
  type SettingsScopeSnapshot,
  type SnapshotStore,
  type WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, SessionMaybeProvideInfo, SessionProvideInfo,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import * as localePlugin from '@deepseek-ai/dsh-client-locale/client'
import * as themePlugin from '@deepseek-ai/dsh-client-ui-theme/client'
import * as layoutPlugin from '@deepseek-ai/dsh-client-ui-layout/client'
import * as sidebarPlugin from '@deepseek-ai/dsh-client-ui-sidebar/client'
import * as conversationPlugin from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as workspacePlugin from '@deepseek-ai/dsh-client-ui-workspace/client'
import * as nativeDirectoryPickerPlugin from '@deepseek-ai/dsh-client-ui-directory-picker-native/client'
import * as settingsGeneralPlugin from '@deepseek-ai/dsh-client-ui-settings-general/client'
import * as officialBrandPlugin from '@deepseek-ai/dsh-client-ui-brand-official/client'
import * as rendererPlugin from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  DesktopRendererFrame, DesktopSessionNotification, DesktopSessionSummary,
} from './shared.ts'

const SEARCH_RESULT_LIMIT = 50
const SETTINGS_PREFIX = 'dsh.desktop.settings.'
const WORKSPACES_KEY = 'dsh.desktop.workspaces.v2'
const ARCHIVED_KEY = 'dsh.desktop.archived-sessions.v1'

interface MutableProjectionFace extends ProjectionsFace {
  set(key: string, value: unknown): void
}

interface AcpMessageEntry {
  kind: 'message'
  role: 'user' | 'assistant'
  id: string
  blocks: ContentBlock[]
}

interface AcpToolEntry {
  kind: 'tool'
  id: string
  title: string
  rawInput: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  output: ContentBlock[]
}

type AcpTranscriptEntry = AcpMessageEntry | AcpToolEntry

interface StoredWorkspace {
  workspaceId: WorkspaceId
  path: string
  title: string
  createdAt: string
  updatedAt: string
  sessionOrder: SessionId[]
}

interface SessionRecord {
  summary: SessionSummary
  session: DesktopSession
  ctx: AgentContext | undefined
  fiber: Fiber | undefined
  provideInfo: SessionProvideInfo | undefined
}

function nowIso(): string {
  return new Date().toISOString()
}

function basename(path: string): string {
  const normalized = path.replace(/[/\\]+$/, '')
  return normalized.split(/[/\\]/).pop() || path
}

function rpcFailure<T>(message: string): RpcResult<T> {
  return {
    ok: false,
    error: { code: 'not-supported', message },
  } as unknown as RpcResult<T>
}

function remoteFailure<T>(message: string): RemoteResult<T> {
  return {
    ok: false,
    error: { code: 'not-supported', message },
  } as unknown as RemoteResult<T>
}

function textContent(value: unknown): ContentBlock[] {
  if (typeof value !== 'object' || value === null) return []
  const candidate = value as { type?: unknown; text?: unknown }
  return candidate.type === 'text' && typeof candidate.text === 'string'
    ? [{ type: 'text', text: candidate.text }]
    : []
}

function toolOutput(update: unknown): ContentBlock[] {
  if (typeof update !== 'object' || update === null) return []
  const content = (update as { content?: unknown }).content
  if (!Array.isArray(content)) return []
  return content.flatMap((item): ContentBlock[] => {
    if (typeof item !== 'object' || item === null) return []
    return textContent((item as { content?: unknown }).content)
  })
}

function safeJson(value: unknown): string {
  if (value === undefined) return '{}'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function projectionFace(): MutableProjectionFace {
  const values = new Map<string, unknown>()
  const listeners = new Map<string, Set<() => void>>()
  const faces = new Map<string, { getSnapshot(): unknown; subscribe(fn: () => void): () => void }>()
  return {
    faceOf(key) {
      let face = faces.get(key)
      if (face === undefined) {
        face = {
          getSnapshot: () => values.get(key),
          subscribe: (listener) => {
            const set = listeners.get(key) ?? new Set<() => void>()
            set.add(listener)
            listeners.set(key, set)
            return () => { set.delete(listener) }
          },
        }
        faces.set(key, face)
      }
      return face
    },
    set(key, value) {
      values.set(key, value)
      for (const listener of [...(listeners.get(key) ?? [])]) listener()
    },
  }
}

function emptySnapshot(sessionId: SessionId, blank: boolean): ConversationSnapshot {
  const chat = EMPTY_CHAT_SNAPSHOT
  return {
    sessionId,
    views: { get: () => undefined },
    chat,
    nodes: chat.legacy.nodes,
    turnTimings: chat.legacy.turnTimings,
    turnEnds: chat.legacy.turnEnds,
    partial: chat.legacy.partial,
    runningCalls: chat.legacy.runningCalls,
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: blank ? 'blank' : 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank,
    lastAgentError: null,
  }
}

class DesktopSession {
  readonly projections: MutableProjectionFace = projectionFace()
  private readonly store: SnapshotStore<ConversationSnapshot>
  private readonly assembler: ConversationNodeAssembler
  private readonly entries: AcpTranscriptEntry[] = []
  private readonly messages = new Map<string, AcpMessageEntry>()
  private readonly tools = new Map<string, AcpToolEntry>()
  private plan: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> = []
  private loaded: boolean
  private blank: boolean
  private running = false
  private promptAttempted = false
  private updatedAt = Date.now()

  constructor(
    readonly sessionId: SessionId,
    private readonly cwd: string,
    conversation: { events: ConversationEventRegistry; views: ConversationViewRegistry },
    private readonly onChanged: (session: DesktopSession) => void,
    options: { loaded: boolean; blank: boolean },
  ) {
    this.loaded = options.loaded
    this.blank = options.blank
    this.assembler = new ConversationNodeAssembler(conversation.events, conversation.views)
    this.store = createSnapshotStore(emptySnapshot(sessionId, options.blank))
  }

  asFace(): SessionFace {
    return this as unknown as SessionFace
  }

  getSnapshot(): ConversationSnapshot {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  summary(title?: string): SessionSummary {
    return {
      id: this.sessionId,
      ...(title === undefined ? {} : { title }),
      displayTitle: title ?? basename(this.cwd),
      cwd: this.cwd,
      running: this.running,
      blank: this.blank,
      updatedAt: this.updatedAt,
    }
  }

  markRuntimeDetached(): void {
    this.loaded = false
    this.running = false
    this.publish()
  }

  markLoaded(): void {
    this.loaded = true
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    await window.dshDesktop.loadSession(this.sessionId, this.cwd)
    this.loaded = true
  }

  rebuildRegistry(): void {
    this.assembler.rebuildRegistry()
    this.publish()
  }

  accept(notification: DesktopSessionNotification): void {
    const update = notification.update
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.acceptMessage('user', update.messageId, update.content)
        break
      case 'agent_message_chunk':
        this.acceptMessage('assistant', update.messageId, update.content)
        break
      case 'tool_call': {
        const id = String(update.toolCallId)
        const status = update.status ?? 'in_progress'
        let entry = this.tools.get(id)
        if (entry === undefined) {
          entry = {
            kind: 'tool', id, title: update.title, rawInput: safeJson(update.rawInput), status, output: [],
          }
          this.tools.set(id, entry)
          this.entries.push(entry)
        } else {
          entry.title = update.title
          entry.rawInput = safeJson(update.rawInput)
          entry.status = status
        }
        break
      }
      case 'tool_call_update': {
        const id = String(update.toolCallId)
        let entry = this.tools.get(id)
        if (entry === undefined) {
          entry = {
            kind: 'tool', id, title: id, rawInput: '{}', status: update.status ?? 'in_progress', output: [],
          }
          this.tools.set(id, entry)
          this.entries.push(entry)
        } else if (update.status !== undefined) {
          entry.status = update.status
        }
        const output = toolOutput(update)
        if (output.length > 0) entry.output = output
        break
      }
      case 'plan':
        this.plan = update.entries.map(entry => ({ content: entry.content, status: entry.status }))
        break
      default:
        return
    }
    this.blank = this.entries.every(entry => entry.kind !== 'message' || entry.role !== 'user')
    this.updatedAt = Date.now()
    this.publish()
    this.onChanged(this)
  }

  private acceptMessage(role: 'user' | 'assistant', rawId: unknown, rawContent: unknown): void {
    const id = typeof rawId === 'string' && rawId !== '' ? rawId : `${role}-${this.entries.length}`
    const blocks = textContent(rawContent)
    if (blocks.length === 0) return
    let entry = this.messages.get(id)
    if (entry === undefined) {
      entry = { kind: 'message', role, id, blocks: [] }
      this.messages.set(id, entry)
      this.entries.push(entry)
    }
    entry.blocks.push(...blocks)
  }

  private syntheticEvents(): SessionEvent[] {
    const events: SessionEvent[] = []
    const baseTime = Date.now()
    let seq = 1
    let turn = 0
    let step = 0
    let turnOpen = false
    let stepOpen = false
    const append = (event: Omit<SessionEvent, 'seq' | 'time'>): void => {
      events.push({ ...event, seq, time: baseTime + seq } as SessionEvent)
      seq += 1
    }
    const openTurn = (): void => {
      if (turnOpen) return
      turn += 1
      step = 0
      append({ type: 'turn/start', data: { turn } } as Omit<SessionEvent, 'seq' | 'time'>)
      turnOpen = true
    }
    const openStep = (): void => {
      openTurn()
      if (stepOpen) return
      step += 1
      append({ type: 'step/start', data: { turn, step } } as Omit<SessionEvent, 'seq' | 'time'>)
      stepOpen = true
    }
    const closeStep = (): void => {
      if (!stepOpen) return
      append({ type: 'step/end', data: { turn, step } } as Omit<SessionEvent, 'seq' | 'time'>)
      stepOpen = false
    }
    const closeTurn = (): void => {
      closeStep()
      if (!turnOpen) return
      append({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as Omit<SessionEvent, 'seq' | 'time'>)
      turnOpen = false
    }

    for (const entry of this.entries) {
      if (entry.kind === 'message' && entry.role === 'user') {
        closeTurn()
        openTurn()
        append({
          type: 'user/message',
          data: { id: entry.id, role: 'user', content: entry.blocks, source: { kind: 'user' } },
          surfaceOp: 'append',
        } as Omit<SessionEvent, 'seq' | 'time'>)
        continue
      }
      openStep()
      if (entry.kind === 'message') {
        append({
          type: 'assistant/message',
          data: {
            turn,
            step,
            message: {
              id: entry.id,
              role: 'assistant',
              content: entry.blocks,
              source: { kind: 'model', provider: 'acp', model: 'runtime' },
            },
          },
          surfaceOp: 'append',
        } as Omit<SessionEvent, 'seq' | 'time'>)
        continue
      }
      append({
        type: 'tool/call',
        data: { turn, step, callId: entry.id, name: entry.title, arguments: entry.rawInput },
      } as Omit<SessionEvent, 'seq' | 'time'>)
      if (entry.status === 'completed' || entry.status === 'failed') {
        append({
          type: 'tool/result',
          data: {
            turn,
            step,
            message: {
              id: `result-${entry.id}`,
              role: 'user',
              source: { kind: 'tool', callId: entry.id },
              content: [{
                type: 'tool-result',
                toolCallId: entry.id,
                content: entry.output,
                isError: entry.status === 'failed',
              }],
            },
          },
          surfaceOp: 'append',
        } as Omit<SessionEvent, 'seq' | 'time'>)
      }
    }
    if (this.plan.length > 0) {
      append({ type: 'todo/write', data: { todos: this.plan } } as Omit<SessionEvent, 'seq' | 'time'>)
    }
    closeTurn()
    return events
  }

  private publish(): void {
    const inputs = this.syntheticEvents().map(event => ({ event }))
    this.assembler.replaceWindow(inputs, false)
    this.assembler.flush()
    const chat = this.assembler.get('chat') ?? EMPTY_CHAT_SNAPSHOT
    const legacy = chat.legacy
    this.store.update((draft) => {
      draft.views = this.assembler
      draft.chat = chat
      draft.nodes = legacy.nodes
      draft.turnTimings = legacy.turnTimings
      draft.turnEnds = legacy.turnEnds
      draft.partial = legacy.partial
      draft.runningCalls = legacy.runningCalls
      draft.running = this.running
      draft.composerPhase = this.blank ? (this.promptAttempted ? 'engaging' : 'blank') : 'active'
      draft.openState = 'open'
      draft.openError = null
      draft.blank = this.blank
    })
  }

  async prompt(content: Array<{ type: string; text?: string }>): Promise<RpcResult<{ accepted: true }>> {
    const text = content
      .flatMap(part => part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
      .join('\n')
    if (text.trim() === '') return rpcFailure('Desktop ACP currently accepts text prompts only.')
    this.promptAttempted = true
    this.running = true
    this.publish()
    this.onChanged(this)
    try {
      await this.ensureLoaded()
      await window.dshDesktop.prompt(this.sessionId, text)
      this.blank = false
      return { ok: true, value: { accepted: true } }
    } catch (error: unknown) {
      return rpcFailure(error instanceof Error ? error.message : String(error))
    } finally {
      this.running = false
      this.updatedAt = Date.now()
      this.publish()
      this.onChanged(this)
    }
  }

  readAttachment(_attachmentId: unknown): Promise<RpcResult<never>> {
    return Promise.resolve(rpcFailure('Historical attachments are not exposed by the standard ACP bridge yet.'))
  }

  updateQueue(_itemId: unknown, _action: unknown): Promise<RpcResult<{ accepted: true }>> {
    return Promise.resolve(rpcFailure('Queue editing requires the DSH ACP product extension.'))
  }

  cancel(): Promise<RpcResult<{ accepted: true }>> {
    window.dshDesktop.cancel(this.sessionId)
    return Promise.resolve({ ok: true, value: { accepted: true } })
  }

  rename(_title: string): Promise<RpcResult<{ title: string; seq: number }>> {
    return Promise.resolve(rpcFailure('Session rename requires the DSH ACP product extension.'))
  }

  loadOlder(): Promise<void> {
    return Promise.resolve()
  }

  command(_line: string): Promise<RemoteResult<{ matched: boolean }>> {
    return Promise.resolve(remoteFailure('Slash commands are not exposed by the standard ACP bridge yet.'))
  }
}

class DesktopSessions {
  readonly list: SnapshotStore<SessionListState> = createSnapshotStore({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  readonly searchResultLimit = SEARCH_RESULT_LIMIT
  readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>
  private readonly records = new Map<SessionId, SessionRecord>()
  private readonly titles = new Map<SessionId, string | undefined>()
  private readonly channel: SessionProvideChannel

  constructor(
    private readonly rootCtx: Context,
    private readonly conversation: { events: ConversationEventRegistry; views: ConversationViewRegistry },
  ) {
    this.channel = new SessionProvideChannel({
      rebuildBundles: () => {
        for (const [id, record] of this.records) {
          if (record.provideInfo !== undefined) {
            const binding = this.binding(id)
            if (binding !== undefined) record.provideInfo = this.channel.materializeInfo(binding)
          }
        }
      },
      resolveCurrent: () => this.maybeProvideInfo(this.list.getSnapshot().current),
    })
    this.currentProvideInfo = this.channel.currentProvideInfo
    this.list.subscribe(() => { this.channel.publishCurrent() })
  }

  asService(): ISessions {
    return this as unknown as ISessions
  }

  async refresh(paths: readonly string[]): Promise<void> {
    const found = new Map<SessionId, DesktopSessionSummary>()
    for (const cwd of paths) {
      for (const row of await window.dshDesktop.listSessions(cwd)) {
        found.set(row.sessionId as SessionId, row)
      }
    }
    for (const row of found.values()) this.adopt(row)
    this.list.update((draft) => {
      draft.ids = [...found.keys()].sort((left, right) =>
        (draft.byId[right]?.updatedAt ?? 0) - (draft.byId[left]?.updatedAt ?? 0))
      const live = new Set(draft.ids)
      for (const id of Object.keys(draft.byId) as SessionId[]) {
        if (!live.has(id)) delete draft.byId[id]
      }
      if (draft.current !== undefined && !live.has(draft.current)) draft.current = undefined
      draft.phase = 'ready'
    })
  }

  async create(cwd: string): Promise<SessionId> {
    const id = await window.dshDesktop.createSession(cwd) as SessionId
    this.adopt({ sessionId: id, cwd }, { loaded: true, blank: true })
    this.list.update((draft) => {
      if (!draft.ids.includes(id)) draft.ids.unshift(id)
      draft.current = id
    })
    return id
  }

  accept(frame: Extract<DesktopRendererFrame, { type: 'session-update' }>): void {
    this.records.get(frame.sessionId as SessionId)?.session.accept(frame.notification)
  }

  runtimeDetached(): void {
    for (const record of this.records.values()) record.session.markRuntimeDetached()
  }

  resumeCurrent(): void {
    const current = this.list.getSnapshot().current
    if (current === undefined) return
    void this.records.get(current)?.session.ensureLoaded().catch((error: unknown) => {
      console.error('[desktop-product] failed to restore current session:', error)
    })
  }

  rebuildConversationRegistries(): void {
    for (const record of this.records.values()) record.session.rebuildRegistry()
  }

  private adopt(row: DesktopSessionSummary, options?: { loaded?: boolean; blank?: boolean }): SessionRecord {
    const id = row.sessionId as SessionId
    this.titles.set(id, row.title)
    let record = this.records.get(id)
    if (record === undefined) {
      const session = new DesktopSession(
        id,
        row.cwd,
        this.conversation,
        changed => this.noteChanged(changed),
        { loaded: options?.loaded ?? false, blank: options?.blank ?? false },
      )
      record = {
        summary: session.summary(row.title), session, ctx: undefined, fiber: undefined, provideInfo: undefined,
      }
      this.records.set(id, record)
    } else if (options?.loaded === true) {
      record.session.markLoaded()
    }
    record.summary = record.session.summary(row.title)
    this.list.update((draft) => { draft.byId[id] = record.summary })
    return record
  }

  private noteChanged(session: DesktopSession): void {
    const record = this.records.get(session.sessionId)
    if (record === undefined) return
    record.summary = session.summary(this.titles.get(session.sessionId))
    this.list.update((draft) => {
      draft.byId[session.sessionId] = record.summary
      if (!draft.ids.includes(session.sessionId)) draft.ids.unshift(session.sessionId)
    })
  }

  provide(descriptor: SessionProvideDescriptor): () => void {
    return this.channel.provide(descriptor)
  }

  private provideInfo(id: SessionId): SessionProvideInfo | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    const binding = this.binding(id)
    if (binding === undefined) return undefined
    record.provideInfo ??= this.channel.materializeInfo(binding)
    return record.provideInfo
  }

  private maybeProvideInfo(id: SessionId | undefined): SessionMaybeProvideInfo {
    return (id === undefined ? undefined : this.provideInfo(id)) ?? this.channel.maybeInfo
  }

  scope(id: SessionId): AgentContext | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    if (record.ctx === undefined) {
      const handle = createScope(this.rootCtx, id)
      record.ctx = handle.ctx
      record.fiber = handle.fiber
    }
    return record.ctx
  }

  scopeOf(ctx: Context): SessionId | undefined {
    return scopeOf(ctx)
  }

  sessionOf(ctx: Context): SessionFace | undefined {
    const id = scopeOf(ctx)
    return id === undefined ? undefined : this.records.get(id)?.session.asFace()
  }

  binding(id: SessionId): SessionBinding | undefined {
    const record = this.records.get(id)
    const ctx = this.scope(id)
    if (record === undefined || ctx === undefined) return undefined
    return { sessionId: id, session: record.session.asFace(), ctx }
  }

  open(id: SessionId): void {
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`desktop sessions: unknown session ${id}`)
    this.list.update((draft) => {
      draft.current = id
      draft.currentAddress = undefined
    })
    void record.session.ensureLoaded().catch((error: unknown) => {
      console.error('[desktop-product] failed to load session:', error)
    })
  }

  clear(): void {
    this.list.update((draft) => {
      draft.current = undefined
      draft.currentAddress = undefined
    })
  }

  openSubagent(_address: unknown): void {}
  subagentAddress(_id: SessionId): undefined { return undefined }
  setSubagentCatalogOpen(_parentSessionId: SessionId, _open: boolean): void {}
  refreshSubagents(_parentSessionId: SessionId): Promise<void> { return Promise.resolve() }
  noteAgentPreset(_sessionId: SessionId, _agentPreset: string): void {}

  search(_query: string, _signal: AbortSignal): ReturnType<ISessions['search']> {
    return Promise.resolve({ ok: true, value: { items: [], hasMore: false } })
  }

  fork(_options: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId> {
    return Promise.reject(new Error('Session fork requires the DSH ACP product extension.'))
  }
}

function readArchived(): SessionId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVED_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is SessionId => typeof value === 'string') : []
  } catch {
    return []
  }
}

function loadStoredWorkspaces(initialPath: string): StoredWorkspace[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACES_KEY) ?? '[]') as unknown
    if (Array.isArray(parsed)) {
      const rows = parsed.flatMap((value): StoredWorkspace[] => {
        if (typeof value !== 'object' || value === null) return []
        const row = value as Partial<Record<keyof StoredWorkspace, unknown>>
        if (typeof row.workspaceId !== 'string' || typeof row.path !== 'string' || typeof row.title !== 'string') return []
        const createdAt = typeof row.createdAt === 'string' ? row.createdAt : nowIso()
        return [{
          workspaceId: row.workspaceId as WorkspaceId,
          path: row.path,
          title: row.title,
          createdAt,
          updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : createdAt,
          sessionOrder: Array.isArray(row.sessionOrder)
            ? row.sessionOrder.filter((id): id is SessionId => typeof id === 'string')
            : [],
        }]
      })
      if (rows.length > 0) return rows
    }
  } catch {}
  const timestamp = nowIso()
  return [{
    workspaceId: initialPath as WorkspaceId,
    path: initialPath,
    title: basename(initialPath),
    createdAt: timestamp,
    updatedAt: timestamp,
    sessionOrder: [],
  }]
}

class DesktopWorkspaces {
  readonly list: SnapshotStore<WorkspaceListState> = createSnapshotStore({
    items: [], archivedSessionIds: readArchived(), state: 'loading', phase: 'pending', error: null,
    baselinesReady: false, recentWorkspaceId: undefined,
  })
  private rows: StoredWorkspace[] = []

  constructor(private readonly sessions: DesktopSessions) {}

  asService(): IWorkspaces {
    return this as unknown as IWorkspaces
  }

  async initialize(initialPath: string): Promise<void> {
    this.rows = loadStoredWorkspaces(initialPath)
    await this.sessions.refresh(this.rows.map(row => row.path))
    this.project()
  }

  private persist(): void {
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(this.rows))
  }

  private persistArchived(ids: readonly SessionId[]): void {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(ids))
  }

  private project(): void {
    const sessions = this.sessions.list.getSnapshot()
    const items: WorkspaceView[] = this.rows.map((row) => {
      const members = sessions.ids.filter(id => sessions.byId[id]?.cwd === row.path)
      const rank = new Map(row.sessionOrder.map((id, index) => [id, index]))
      members.sort((left, right) => {
        const leftRank = rank.get(left)
        const rightRank = rank.get(right)
        if (leftRank !== undefined || rightRank !== undefined) {
          return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER)
        }
        return (sessions.byId[right]?.updatedAt ?? 0) - (sessions.byId[left]?.updatedAt ?? 0)
      })
      return {
        workspaceId: row.workspaceId,
        title: row.title,
        path: row.path,
        sessionIds: members,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    })
    this.list.update((draft) => {
      draft.items = items
      draft.state = 'idle'
      draft.phase = 'ready'
      draft.error = null
      draft.baselinesReady = true
      draft.recentWorkspaceId = items[0]?.workspaceId
    })
  }

  syncSessions(): void {
    this.project()
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.rows.find(row => row.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error(`desktop workspaces: unknown workspace ${workspaceId}`)
    const list = this.sessions.list.getSnapshot()
    const archived = this.list.getSnapshot().archivedSessionIds
    for (const id of list.ids) {
      const summary = list.byId[id]
      if (summary?.cwd === workspace.path && summary.blank && !archived.includes(id)) return id
    }
    const id = await this.sessions.create(workspace.path)
    workspace.sessionOrder = [id, ...workspace.sessionOrder.filter(candidate => candidate !== id)]
    workspace.updatedAt = nowIso()
    this.persist()
    this.project()
    return id
  }

  startSession(workspaceId?: WorkspaceId): void {
    const list = this.list.getSnapshot()
    const current = this.sessions.list.getSnapshot().current
    const currentCwd = current === undefined ? undefined : this.sessions.list.getSnapshot().byId[current]?.cwd
    const target = workspaceId
      ?? list.items.find(item => item.path === currentCwd)?.workspaceId
      ?? list.recentWorkspaceId
    if (target === undefined) {
      this.sessions.clear()
      return
    }
    void this.connectWorkspace(target).then(id => { this.sessions.open(id) }).catch((error: unknown) => {
      console.error('[desktop-product] failed to start session:', error)
    })
  }

  async create(input: { path: string }): Promise<WorkspaceView> {
    let row = this.rows.find(candidate => candidate.path === input.path)
    if (row === undefined) {
      const timestamp = nowIso()
      row = {
        workspaceId: input.path as WorkspaceId,
        path: input.path,
        title: basename(input.path),
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionOrder: [],
      }
      this.rows.push(row)
      this.persist()
      await this.sessions.refresh(this.rows.map(candidate => candidate.path))
    }
    this.project()
    const view = this.list.getSnapshot().items.find(item => item.workspaceId === row.workspaceId)
    if (view === undefined) throw new Error('desktop workspace projection failed after create')
    return view
  }

  pickDirectory(): Promise<string | null> {
    return window.dshDesktop.pickDirectory()
  }

  listDirectory(path?: string): Promise<DirectoryListing> {
    return window.dshDesktop.listDirectory(path)
  }

  createDirectory(path: string, name: string): Promise<string> {
    return window.dshDesktop.createDirectory(path, name)
  }

  openPath(path: string): Promise<void> {
    return window.dshDesktop.openPath(path)
  }

  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    const row = this.rows.find(item => item.workspaceId === workspaceId)
    if (row === undefined) throw new Error(`desktop workspaces: unknown workspace ${workspaceId}`)
    row.title = title.trim() || row.title
    row.updatedAt = nowIso()
    this.persist()
    this.project()
    const view = this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    if (view === undefined) throw new Error('desktop workspace projection failed after rename')
    return view
  }

  async delete(workspaceId: WorkspaceId): Promise<void> {
    this.rows = this.rows.filter(row => row.workspaceId !== workspaceId)
    this.persist()
    this.project()
  }

  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    const index = this.rows.findIndex(row => row.workspaceId === workspaceId)
    if (index < 0) return
    const [row] = this.rows.splice(index, 1)
    if (row === undefined) return
    row.updatedAt = nowIso()
    const before = beforeWorkspaceId === undefined ? -1 : this.rows.findIndex(item => item.workspaceId === beforeWorkspaceId)
    if (before < 0) this.rows.push(row)
    else this.rows.splice(before, 0, row)
    this.persist()
    this.project()
  }

  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    const row = this.rows.find(item => item.workspaceId === workspaceId)
    if (row === undefined) throw new Error(`desktop workspaces: unknown workspace ${workspaceId}`)
    const current = row.sessionOrder.filter(id => id !== sessionId)
    const before = beforeSessionId === undefined ? -1 : current.indexOf(beforeSessionId)
    if (before < 0) current.push(sessionId)
    else current.splice(before, 0, sessionId)
    row.sessionOrder = current
    row.updatedAt = nowIso()
    this.persist()
    this.project()
    const view = this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    if (view === undefined) throw new Error('desktop workspace projection failed after session reorder')
    return view
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    this.list.update((draft) => {
      if (!draft.archivedSessionIds.includes(sessionId)) {
        draft.archivedSessionIds = [...draft.archivedSessionIds, sessionId]
      }
    })
    this.persistArchived(this.list.getSnapshot().archivedSessionIds)
    if (this.sessions.list.getSnapshot().current === sessionId) this.sessions.clear()
  }
}

class LocalSettingsScope<T extends Record<string, unknown>> implements SettingsScope<T> {
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private value: T | undefined

  constructor(private readonly namespace: string) {
    try {
      const raw = localStorage.getItem(`${SETTINGS_PREFIX}${namespace}`)
      this.value = raw === null ? undefined : JSON.parse(raw) as T
    } catch {
      this.value = undefined
    }
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return {
      status: 'ready',
      value: this.value,
      base: undefined,
      user: this.value,
      revision: this.revision,
      writable: true,
      mode: 'memory',
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    this.value = { ...(this.value ?? {}), [field]: value } as T
    this.commit()
  }

  async unset(field: string): Promise<void> {
    if (this.value === undefined) return
    const next = { ...this.value }
    delete next[field]
    this.value = next as T
    this.commit()
  }

  private commit(): void {
    this.revision += 1
    localStorage.setItem(`${SETTINGS_PREFIX}${this.namespace}`, JSON.stringify(this.value))
    for (const listener of [...this.listeners]) listener()
  }
}

class LocalSettingsBinder {
  private readonly scopes = new Map<string, LocalSettingsScope<Record<string, unknown>>>()

  bind<T extends Record<string, unknown>>(spec: { namespace: string }): SettingsScope<T> {
    let scope = this.scopes.get(spec.namespace)
    if (scope === undefined) {
      scope = new LocalSettingsScope(spec.namespace)
      this.scopes.set(spec.namespace, scope)
    }
    return scope as unknown as SettingsScope<T>
  }

  describe(): never {
    throw new Error('Desktop local settings do not expose a Host settings document.')
  }
}

function connectionStub(): ConnectionHandle {
  return {
    api: {} as ConnectionHandle['api'],
    isLoopback: false,
    hostDescription: {
      getSnapshot: () => undefined,
      subscribe: (_listener: () => void) => () => {},
    },
    rpc: {} as ConnectionHandle['rpc'],
    start: () => ({ stop: () => {} }),
  }
}

function remoteStub(): object {
  const methods = new Proxy({}, {
    get: (_target, property) => {
      if (property === '$on') return () => () => {}
      if (property === '$dispatch') return () => {}
      return () => Promise.reject(new Error(`Desktop ACP remote capability ${String(property)} is unavailable.`))
    },
  })
  return methods
}

async function mountPlugin(ctx: Context, plugin: object): Promise<void> {
  await ctx.plugin(plugin).await()
}

/** Mount the shared product UI over the ACP-native Desktop object layer. */
export async function mountDesktopProduct(container: HTMLElement): Promise<() => void> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()

  const conversation = {
    events: ctx.get('conversationEvents') as ConversationEventRegistry,
    views: ctx.get('conversationViews') as ConversationViewRegistry,
  }
  const sessions = new DesktopSessions(ctx, conversation)
  const workspaces = new DesktopWorkspaces(sessions)
  ctx.provide('sessions', sessions.asService())
  ctx.provide('workspaces', workspaces.asService())
  ctx.provide('connection', connectionStub())
  ctx.provide('remote', remoteStub() as never)
  ctx.provide('settingsScope', new LocalSettingsBinder() as unknown as SettingsScopeBinder)

  await mountPlugin(ctx, localePlugin)
  await mountPlugin(ctx, themePlugin)
  await mountPlugin(ctx, layoutPlugin)
  await mountPlugin(ctx, sidebarPlugin)
  await mountPlugin(ctx, conversationPlugin)
  await mountPlugin(ctx, workspacePlugin)
  await mountPlugin(ctx, nativeDirectoryPickerPlugin)
  await mountPlugin(ctx, settingsGeneralPlugin)
  await mountPlugin(ctx, officialBrandPlugin)
  await mountPlugin(ctx, rendererPlugin)
  sessions.rebuildConversationRegistries()

  const unsubscribeFrames = window.dshDesktop.subscribe((frame) => {
    if (frame.type === 'session-update') {
      sessions.accept(frame)
      return
    }
    if (frame.status === 'starting' || frame.status === 'stopped') sessions.runtimeDetached()
    if (frame.status === 'ready') sessions.resumeCurrent()
    if (frame.status === 'failed') {
      sessions.runtimeDetached()
      console.error('[desktop-product] ACP Runtime failed:', frame.message ?? 'unknown error')
    }
  })

  const initialWorkspace = await window.dshDesktop.workspace()
  await workspaces.initialize(initialWorkspace)
  workspaces.syncSessions()
  const initial = sessions.list.getSnapshot().ids[0]
  if (initial !== undefined) sessions.open(initial)

  const unsubscribeSessions = sessions.list.subscribe(() => { workspaces.syncSessions() })
  const unmount = ctx.uiRenderer.mount(container)

  return () => {
    unsubscribeFrames()
    unsubscribeSessions()
    unmount()
    void ctx.dispose()
  }
}
