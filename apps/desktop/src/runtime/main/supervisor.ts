/** Enterprise-authorized ACP process, credential renewal and history replay. */
import { BrowserWindow, dialog } from 'electron'
import { connectAcpRuntime, type AcpClientHandlers, type AcpRuntimeConnection, type AcpRuntimeSpec } from '@deepseek-ai/dsh-acp-client'
import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { DesktopPromptPart } from '../../desktop-prompt.ts'
import type { StoredModelSettings } from '../../desktop-model-storage.ts'
import type { DesktopContentStore } from '../../desktop-content.ts'
import type { DesktopDiagnostics } from '../../diagnostics/main/diagnostics.ts'
import type { DesktopRendererFrame, DesktopPromptResult, DesktopSessionSummary } from '../../shared.ts'
import { DesktopRuntimeCredentialLifetime } from '../../desktop-runtime-credential.ts'
import { enterpriseRuntimeScope, assertEnterpriseSessionAccess, claimEnterpriseSession, filterEnterpriseSessions } from '../../desktop-enterprise-scope-main.ts'
import { sameEnterpriseRuntimeScope } from '../../desktop-enterprise-runtime-shared.ts'
type PermissionRequest = Parameters<NonNullable<AcpClientHandlers['onPermissionRequest']>>[0]
function permissionLabel(kind: PermissionRequest['options'][number]['kind']): string { switch (kind) { case 'allow_once': return '仅本次允许'; case 'allow_always': return '本任务内允许'; case 'reject_once': return '拒绝'; case 'reject_always': return '始终拒绝'; default: return kind } }
/** One subprocess with captured enterprise authority and immutable model settings. */
export class AcpRuntimeSupervisor {
  private readonly capturedScope = enterpriseRuntimeScope()
  constructor(
    private readonly spec: (
      lifetime: DesktopRuntimeCredentialLifetime, snapshot: StoredModelSettings | undefined,
    ) => Promise<AcpRuntimeSpec>,
    private readonly snapshot: StoredModelSettings | undefined,
    private readonly desktopContent: () => DesktopContentStore,
    private readonly desktopDiagnostics: () => DesktopDiagnostics,
    private readonly desktopWorkspace: () => string,
  ) {}
  private isStopping(): boolean { return this.stopping }
  private assertScope(): void {
    if (!sameEnterpriseRuntimeScope(this.capturedScope, enterpriseRuntimeScope())) throw new Error('企业作用域已变更')
  }

  private readonly credentialLifetime = new DesktopRuntimeCredentialLifetime()
  private notifications: Promise<void> = Promise.resolve()
  private readonly loadingSessions = new Map<string, { cwd: string; promise: Promise<void> }>()
  private connection: AcpRuntimeConnection | undefined
  private stopping = false
  private connecting: Promise<AcpRuntimeConnection> | undefined
  private window: BrowserWindow | undefined
  private readonly unsubmittedSessions = new Set<string>()
  private readonly detachedEmptySessions = new Set<string>()
  private readonly preparingSessions = new Map<string, Promise<string>>()
  private readonly sessionWorkspaces = new Map<string, string>()
  attachWindow(window: BrowserWindow): void { this.window = window }
  running(): boolean { return this.connection !== undefined || this.connecting !== undefined }
  private publish(frame: DesktopRendererFrame): void {
    if (!sameEnterpriseRuntimeScope(this.capturedScope, enterpriseRuntimeScope())) return
    const window = this.window
    if (window === undefined || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send('dsh:frame', frame)
  }
  private publishStatus(status: Extract<DesktopRendererFrame, { type: 'runtime-status' }>['status'], message?: string): void { this.publish({ type: 'runtime-status', status, preserveSessions: true, sessionsRestoredByHost: true, ...(message === undefined ? {} : { message }) }) }
  private async requestPermission(request: PermissionRequest): Promise<ReturnType<NonNullable<AcpClientHandlers['onPermissionRequest']>> extends Promise<infer R> ? R : never> { const window = this.window; if (window === undefined || request.options.length === 0) return { outcome: { outcome: 'cancelled' } }; const buttons = request.options.map(option => permissionLabel(option.kind)); this.assertScope(); this.desktopDiagnostics().record(request.sessionId, 'permission-request', request); const result = await dialog.showMessageBox(window, { type: 'warning', message: `Orbis AI 请求执行工具操作 ${request.toolCall.toolCallId}`, detail: '请确认是否执行此操作。文件与系统访问仍受客户端权限限制。', buttons, cancelId: Math.max(0, request.options.findIndex(option => option.kind.startsWith('reject_'))), noLink: true }); this.assertScope(); const option = request.options[result.response]; return option === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: option.optionId } } }
  async start(): Promise<void> {
    this.assertScope()
    if (process.env.OBIS_DESKTOP_REQUIRED?.trim() === '1' && enterpriseRuntimeScope() === undefined) {
      this.publishStatus('stopped', 'Waiting for a validated enterprise runtime scope')
      throw new Error('A validated enterprise runtime scope is required before ACP Runtime can start')
    }
    if (this.stopping) throw new Error('Runtime 正在停止')
    if (this.connection !== undefined) return
    if (this.connecting !== undefined) { await this.connecting; return }
    this.publishStatus('starting')
    const pending = this.spec(this.credentialLifetime, this.snapshot).then(async (spec) => {
      this.assertScope()
      if (this.stopping) throw new Error('Runtime 正在停止')
      const connection = await connectAcpRuntime(spec, {
        onSessionUpdate: (notification) => {
          this.notifications = this.notifications.then(async () => {
            this.assertScope()
            await assertEnterpriseSessionAccess(notification.sessionId)
            this.assertScope()
            this.desktopDiagnostics().record(notification.sessionId, 'session-update', notification)
            this.publish({ type: 'session-update', sessionId: notification.sessionId, notification })
          }).catch(() => { /* Revoked or unowned session updates never reach the new authority. */ })
        },
        onPermissionRequest: request => this.requestPermission(request),
        onRuntimeStderr: (text) => {
          if (this.isStopping() || !sameEnterpriseRuntimeScope(this.capturedScope, enterpriseRuntimeScope())) return
          for (const id of this.sessionWorkspaces.keys()) this.desktopDiagnostics().record(id, 'runtime-stderr', { text })
        },
      })
      if (this.isStopping() || !sameEnterpriseRuntimeScope(this.capturedScope, enterpriseRuntimeScope())) {
        await connection.dispose()
        throw new Error('企业作用域已变更或 Runtime 已停止')
      }
      return connection
    })
    this.connecting = pending
    try {
      const connection = await pending
      this.connection = connection
      this.publishStatus('ready')
      void connection.client.closed.then(() => {
        if (this.connection !== connection) return
        this.connection = undefined
        this.publishStatus('failed', 'ACP Runtime connection closed unexpectedly')
      })
    } catch (error: unknown) {
      this.publishStatus('failed', error instanceof Error ? error.message : String(error))
      throw error
    } finally { if (this.connecting === pending) this.connecting = undefined }
  }
  /** Stop admissions and await subprocess termination, including an in-flight startup. */
  async stop(silent = false): Promise<void> {
    this.stopping = true
    const pending = this.connecting
    const starting = pending === undefined ? undefined : await pending.catch(() => undefined)
    const connection = this.connection ?? starting
    this.connection = undefined
    if (this.connecting === pending) this.connecting = undefined
    if (connection !== undefined) await connection.dispose()
    await this.notifications
    if (!silent) this.publishStatus('stopped')
  }
  async restart(): Promise<void> {
    for (const id of this.unsubmittedSessions) this.detachedEmptySessions.add(id)
    await this.stop()
    this.stopping = false
    await this.start()
  }
  private async runtime(): Promise<AcpRuntimeConnection> { await this.start(); if (this.connection === undefined) throw new Error('ACP Runtime is not available'); return this.connection }
  workspace(): string { return this.desktopWorkspace() }
  async listSessions(cwd = this.desktopWorkspace()): Promise<DesktopSessionSummary[]> {
    const runtime = await this.runtime()
    const result = await runtime.client.listSessions({ cwd })
    const rows = result.sessions.map(session => ({
      sessionId: session.sessionId,
      cwd: session.cwd,
      ...(session.title === undefined || session.title === null ? {} : { title: session.title }),
    }))
    this.assertScope()
    return filterEnterpriseSessions(rows)
  }
  async createSession(cwd = this.desktopWorkspace(), replaceEmptySessionId?: string): Promise<string> {
    if (replaceEmptySessionId !== undefined) {
      await assertEnterpriseSessionAccess(replaceEmptySessionId)
      if (!this.unsubmittedSessions.has(replaceEmptySessionId) || this.sessionWorkspaces.get(replaceEmptySessionId) !== cwd) throw new Error('只能重新建立当前工作区中尚未发送的空会话')
    }
    const runtime = await this.runtime()
    const created = await runtime.client.newSession({ cwd, mcpServers: [] })
    this.assertScope()
    await claimEnterpriseSession(created.sessionId, cwd)
    this.sessionWorkspaces.set(created.sessionId, cwd)
    this.unsubmittedSessions.add(created.sessionId)
    if (replaceEmptySessionId !== undefined) {
      this.detachedEmptySessions.delete(replaceEmptySessionId)
      this.unsubmittedSessions.delete(replaceEmptySessionId)
      this.sessionWorkspaces.delete(replaceEmptySessionId)
    }
    return created.sessionId
  }
  async loadSession(sessionId: string, cwd = this.desktopWorkspace()): Promise<void> {
    const current = this.loadingSessions.get(sessionId)
    if (current) {
      if (current.cwd !== cwd) throw new Error('会话正在另一个工作区恢复。')
      return current.promise
    }
    const promise = this.replaySession(sessionId, cwd)
    this.loadingSessions.set(sessionId, { cwd, promise })
    try { await promise } finally {
      if (this.loadingSessions.get(sessionId)?.promise === promise) this.loadingSessions.delete(sessionId)
    }
  }
  private async replaySession(sessionId: string, cwd: string): Promise<void> {
    this.assertScope()
    await assertEnterpriseSessionAccess(sessionId)
    const runtime = await this.runtime()
    this.publish({ type: 'session-replay', sessionId, phase: 'starting' })
    try {
      await runtime.client.loadSession({ sessionId, cwd, mcpServers: [] })
      await this.notifications
      this.publish({ type: 'session-replay', sessionId, phase: 'ready' })
      this.sessionWorkspaces.set(sessionId, cwd)
    } catch (error) {
      this.publish({ type: 'session-replay', sessionId, phase: 'failed' })
      throw error
    }
  }
  private async renewCredentials(): Promise<void> {
    await this.restart()
    for (const [id, cwd] of this.sessionWorkspaces) {
      if (!this.unsubmittedSessions.has(id)) await this.loadSession(id, cwd)
    }
  }
  async prepareSession(sessionId: string): Promise<string> {
    const current = this.preparingSessions.get(sessionId)
    if (current) return current
    const operation = this.prepareOwnedSession(sessionId)
    this.preparingSessions.set(sessionId, operation)
    try { return await operation } finally {
      if (this.preparingSessions.get(sessionId) === operation) this.preparingSessions.delete(sessionId)
    }
  }
  private async prepareOwnedSession(sessionId: string): Promise<string> {
    this.assertScope()
    await assertEnterpriseSessionAccess(sessionId)
    return this.credentialLifetime.run(() => this.renewCredentials(), async () => {
      if (!this.detachedEmptySessions.has(sessionId)) return sessionId
      const cwd = this.sessionWorkspaces.get(sessionId)
      if (cwd === undefined) throw new Error('空会话缺少工作区')
      return this.createSession(cwd, sessionId)
    })
  }
  async prompt(sessionId: string, parts: readonly DesktopPromptPart[]): Promise<DesktopPromptResult> {
    return this.credentialLifetime.run(() => this.renewCredentials(), () => this.performPrompt(sessionId, parts))
  }
  private async performPrompt(sessionId: string, parts: readonly DesktopPromptPart[]): Promise<DesktopPromptResult> { this.assertScope(); await assertEnterpriseSessionAccess(sessionId); this.desktopDiagnostics().record(sessionId, 'model-settings', this.snapshot); const runtime = await this.runtime(), cwd = this.sessionWorkspaces.get(sessionId) ?? this.desktopWorkspace(), before = await this.desktopContent().snapshot(cwd), prompt: ContentBlock[] = [], attachmentIds: string[] = []; for (const part of parts) { if (part.type === 'text') { if (part.text !== '') prompt.push({ type: 'text', text: part.text }); continue } prompt.push(...await this.desktopContent().promptBlocks(sessionId, [part.attachmentId])); attachmentIds.push(part.attachmentId) } this.assertScope(); await assertEnterpriseSessionAccess(sessionId); this.unsubmittedSessions.delete(sessionId); const result = await runtime.client.prompt({ sessionId, prompt }); await this.notifications; this.assertScope(); this.desktopContent().consumeAttachments(sessionId, [...new Set(attachmentIds)]); return { stopReason: result.stopReason, artifacts: await this.desktopContent().captureArtifacts(sessionId, cwd, before) } }
  cancel(sessionId: string): void { void assertEnterpriseSessionAccess(sessionId).then(() => this.runtime()).then(runtime => runtime.client.cancel({ sessionId })).catch((error: unknown) => { this.publishStatus('failed', error instanceof Error ? error.message : String(error)) }) }
  async closeSession(sessionId: string): Promise<void> {
    this.assertScope()
    await assertEnterpriseSessionAccess(sessionId)
    const runtime = await this.runtime()
    await runtime.client.closeSession({ sessionId })
    this.unsubmittedSessions.delete(sessionId)
    this.detachedEmptySessions.delete(sessionId)
    this.sessionWorkspaces.delete(sessionId)
  }
}
