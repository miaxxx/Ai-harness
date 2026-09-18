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
  ai(input: DesktopApplicationAiRequest): Promise<DesktopApplicationAiResult>
}

declare global {
  interface Window {
    dshApplications: DesktopApplicationBridge
  }
}
