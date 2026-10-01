import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import type { DesktopNavigationItem } from './desktop-obis-identity-shared.ts'

export interface DesktopApplicationNavigationRecord {
  id: string
  label: string
  page: string
  group?: string
  moduleId: string
  moduleVersion: string
}

export interface DesktopApplicationUiNode {
  component: string
  id?: string
  tokenRefs?: string[]
  props?: Record<string, unknown>
  children?: DesktopApplicationUiNode[]
}

export interface DesktopApplicationPageSchema {
  id: string
  title: string
  pattern?: string
  layout: DesktopApplicationUiNode
  source?: { query: string }
  actions?: string[]
}

export interface DesktopApplicationPermissionDecision {
  moduleId: string
  moduleVersion: string
  visible: boolean
  executable: boolean
  configurable: boolean
  editable: boolean
  administerable: boolean
  reasons: string[]
}

export type DesktopApplicationFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'datetime' | 'json' | 'ref'

export interface DesktopApplicationActionField {
  type: DesktopApplicationFieldType
  required: boolean
  ref?: string
}

export interface DesktopApplicationActionBinding {
  name: string
  target: string
  risk?: 'low' | 'medium' | 'high' | 'critical'
  approval?: string
  input: Record<string, DesktopApplicationActionField>
}

export interface DesktopApplicationRuntimeBindings {
  query?: {
    name: string
    object: string
    fields: string[]
    filterable: string[]
    filters: Record<string, {
      type: DesktopApplicationFieldType
      ref?: string
    }>
    defaultLimit?: number
    maxLimit?: number
  }
  actions: DesktopApplicationActionBinding[]
}

export interface DesktopApplicationPageEnvelope {
  module: { id: string; version: string; name: string }
  page: DesktopApplicationPageSchema
  designSystem: { id: string; version: string }
  permissions: DesktopApplicationPermissionDecision
  runtime?: DesktopApplicationRuntimeBindings
}

export type DesktopApplicationPreviewPersona = 'employee' | 'manager' | 'auditor' | 'developer'

export interface DesktopApplicationPreviewPageRequest extends DesktopEnterpriseScopeRequest {
  previewId: string
  pageId: string
  persona: DesktopApplicationPreviewPersona
}

export interface DesktopApplicationPreviewPageEnvelope {
  preview: {
    id: string
    moduleId: string
    moduleVersion: string
    sourceRevision: number
    persona: DesktopApplicationPreviewPersona
    workspace: {
      resourceId: string
      provider: 'logical' | 'remote'
      infrastructureBacked: boolean
      runtimeEnvironmentId: string
      isolationKey: string
      namespace?: string
      endpoint?: string
      status: 'ready' | 'tearing-down' | 'expired'
      createdAt?: string
      expiresAt: string
    }
  }
  module: { id: string; version: string; name: string }
  page: DesktopApplicationPageSchema
  designSystem: { id: string; version: string }
  permissions: DesktopApplicationPermissionDecision
}

export interface DesktopApplicationPageRequest extends DesktopEnterpriseScopeRequest {
  moduleId: string
  pageId: string
}

export interface DesktopApplicationQueryRequest extends DesktopApplicationPageRequest {
  id?: string
  where?: Record<string, unknown>
  limit?: number
  context?: Record<string, unknown>
}

export interface DesktopApplicationQueryItem {
  id: string
  object: string
  values: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

export interface DesktopApplicationQueryResult {
  requestId: string
  status: 'executed' | 'denied' | 'invalid'
  query: string
  object?: string
  artifactId?: string
  decision: {
    allowed: boolean
    matchedPolicies: string[]
    reason: string
  }
  items: DesktopApplicationQueryItem[]
  truncated: boolean
  errors: string[]
}

export interface DesktopApplicationActionRequest extends DesktopApplicationPageRequest {
  action: string
  input: Record<string, unknown>
  targetId?: string
  expectedVersion?: number
  idempotencyKey?: string
}

export interface DesktopApplicationActionResult {
  requestId: string
  idempotencyKey: string
  status: 'executed' | 'denied' | 'approval-required' | 'invalid' | 'failed'
  decision: {
    allowed: boolean
    matchedPolicies: string[]
    reason: string
    requiresApproval?: string
  }
  output?: unknown
}

export interface DesktopApplicationApprovalRequest extends DesktopEnterpriseScopeRequest {
  approvalId: string
}

export interface DesktopApplicationApprovalStatus {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
  version: number
  action: string
  gate: string
  requesterId: string
  updatedAt: string
  currentStage: {
    id: string
    name?: string
    quorum: number
    approvals: number
    rejections: number
  }
}

/** Public Workspace task row. Omits tenant identifiers and createdBy. */
export interface DesktopApplicationTask {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  version: number
  assignee?: { type: string; id: string }
  dueAt?: string
}

/** Public Approval inbox row. Omits tenant identifiers. */
export interface DesktopApplicationInboxApproval {
  id: string
  requestId: string
  action: string
  gate: string
  status: string
  version: number
  requesterId: string
  updatedAt: string
  currentStage: DesktopApplicationApprovalStatus['currentStage']
}

export interface DesktopApplicationTaskListRequest extends DesktopEnterpriseScopeRequest {}

export interface DesktopApplicationTaskTransitionRequest extends DesktopEnterpriseScopeRequest {
  taskId: string
  expectedVersion: number
  status: 'running' | 'waiting' | 'completed' | 'cancelled'
}

export interface DesktopApplicationApprovalInboxRequest extends DesktopEnterpriseScopeRequest {}

export interface DesktopApplicationApprovalDecisionRequest extends DesktopEnterpriseScopeRequest {
  approvalId: string
  expectedVersion: number
  decision: 'approve' | 'reject'
}

export interface DesktopApplicationKnowledgeSearchRequest extends DesktopEnterpriseScopeRequest {
  query: string
  limit?: number
}

/** Public knowledge search hit. Omits tenant identifiers. */
export interface DesktopApplicationKnowledgeHit {
  id: string
  title: string
  content: string
  source?: string
  citation?: string
  version: number
  updatedAt: string
}

export interface DesktopApplicationAiRequest extends DesktopApplicationPageRequest {
  mode: 'summary' | 'compose'
  prompt?: string
  context?: unknown
}

export interface DesktopApplicationAiResult {
  mode: 'summary' | 'compose'
  text: string
  traceId: string
  providerProfileId: string
  modelId: string
}

export interface DesktopModuleNavigationItem extends DesktopNavigationItem {
  kind: 'module'
  moduleId: string
  modulePageId: string
  moduleVersion: string
}

export interface DesktopApplicationBridge {
  navigation(scope: DesktopEnterpriseScopeRequest): Promise<DesktopApplicationNavigationRecord[]>
  page(input: DesktopApplicationPageRequest): Promise<DesktopApplicationPageEnvelope>
  previewPage(input: DesktopApplicationPreviewPageRequest): Promise<DesktopApplicationPreviewPageEnvelope>
  query(input: DesktopApplicationQueryRequest): Promise<DesktopApplicationQueryResult>
  action(input: DesktopApplicationActionRequest): Promise<DesktopApplicationActionResult>
  approval(input: DesktopApplicationApprovalRequest): Promise<DesktopApplicationApprovalStatus>
  /**
   * Lists entitled Workspace tasks for the validated environment.
   * @param input Project and environment already validated on the Desktop host.
   * @returns Public task rows without tenant identifiers.
   */
  tasks(input: DesktopApplicationTaskListRequest): Promise<{ items: DesktopApplicationTask[] }>
  /**
   * Transitions one entitled Workspace task.
   * @param input Task id, expectedVersion and target status.
   * @returns The public task after the transition.
   */
  transitionTask(input: DesktopApplicationTaskTransitionRequest): Promise<DesktopApplicationTask>
  /**
   * Lists the authenticated employee's Approval inbox for the validated environment.
   * @param input Project and environment already validated on the Desktop host.
   * @returns Waiting-for-me rows without tenant identifiers.
   */
  approvalInbox(input: DesktopApplicationApprovalInboxRequest): Promise<{ waitingForMe: DesktopApplicationInboxApproval[] }>
  /**
   * Submits an approve or reject decision through Approval Runtime.
   * @param input Approval id, expectedVersion and decision.
   * @returns Public approval status without tenant identifiers.
   */
  decideApproval(input: DesktopApplicationApprovalDecisionRequest): Promise<DesktopApplicationApprovalStatus>
  /**
   * Searches entitled knowledge for the validated environment.
   * Membership tenant and actor come from the Desktop bearer session.
   * @param input Environment plus the page-title query; optional limit.
   * @returns Public hits without tenant identifiers.
   */
  searchKnowledge(input: DesktopApplicationKnowledgeSearchRequest): Promise<{ items: DesktopApplicationKnowledgeHit[] }>
  ai(input: DesktopApplicationAiRequest): Promise<DesktopApplicationAiResult>
}

/** Fixed business routes exposed to the trusted native renderer. */
export type DesktopBusinessEntry = 'applications' | 'spaces' | 'knowledge' | 'builder'

/** Native host controls; no credentials or arbitrary URLs cross this interface. */
export interface DesktopBusinessBridge {
  /** Prepare the authenticated initial document behind the conversation. */
  prepare(): Promise<void>
  openPage(input: DesktopApplicationPageRequest): Promise<void>
  openEntry(entry: DesktopBusinessEntry): Promise<void>
  onSessionEnded(listener: () => void): () => void
  hide(): Promise<void>
  setBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>
}

declare global {
  interface Window {
    dshApplications: DesktopApplicationBridge
    dshBusiness: DesktopBusinessBridge
  }
}
