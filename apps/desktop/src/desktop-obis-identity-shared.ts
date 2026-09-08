export interface DesktopObisMembership {
  tenantId: string
  roles: string[]
  status: string
}

export interface DesktopObisIdentityStatus {
  configured: boolean
  required: boolean
  authenticated: boolean
  baseURL?: string
  tenantId?: string
  deviceId?: string
  expiresAt?: string
  refreshExpiresAt?: string
  user?: { id: string; displayName: string; primaryEmail?: string }
  membership?: DesktopObisMembership
  memberships?: DesktopObisMembership[]
}

export interface DesktopObisIdentityConfiguration {
  baseURL: string
  tenantId: string
}

export interface DesktopObisDeviceAuthorization {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresInSeconds: number
  intervalSeconds: number
}

export type DesktopObisDeviceExchange =
  | { status: 'authorization_pending' | 'slow_down'; retryAfterSeconds?: number }
  | { status: 'authenticated'; identity: DesktopObisIdentityStatus }

export interface DesktopEnterpriseEnvironment {
  id: string
  tenantId: string
  name: string
  kind: 'development' | 'staging' | 'production' | 'custom'
  status: 'active' | 'disabled'
  createdAt: string
}

export interface DesktopEnterpriseProject {
  id: string
  tenantId: string
  name: string
  description?: string
  createdAt: string
}

export interface DesktopEnterpriseTenantContext {
  id: string
  displayName: string
  roles: string[]
  projects: DesktopEnterpriseProject[]
  environments: DesktopEnterpriseEnvironment[]
}

export interface DesktopEnterpriseContext {
  currentTenantId: string
  user: { id: string; displayName: string; primaryEmail?: string }
  deviceId: string | null
  tenants: DesktopEnterpriseTenantContext[]
}

export type DesktopNavKind =
  | 'new-task'
  | 'team'
  | 'assistants'
  | 'skills'
  | 'automation'
  | 'knowledge'
  | 'operations'
  | 'module'
  | 'custom'

export interface DesktopNavigationItem {
  id: string
  label: string
  kind: DesktopNavKind
  route: string
  icon?: string
  section?: string
  order: number
  requiredRoles?: string[]
  optional?: boolean
  moduleId?: string
}

export interface DesktopUserPreference {
  tenantId: string
  userId: string
  pinnedIds: string[]
  hiddenOptionalIds: string[]
  navigationOrder: string[]
  defaultProjectId?: string
  defaultEnvironmentId?: string
  version: number
  updatedAt: string
}

export interface DesktopResolvedWorkspace {
  shellVersion: 1
  definitionId: string
  definitionVersion: number
  branding: { productName: string; logoRef?: string; accent?: string }
  navigation: DesktopNavigationItem[]
  contextPane: { mode: 'none' | 'team' | 'assistants' | 'spaces' | 'module'; title?: string; moduleId?: string }
  homeRoute: string
  preferences: DesktopUserPreference
  customization: {
    enterpriseManaged: true
    canManageEnterprise: boolean
    userMayReorder: true
    userMayHideOptional: true
  }
}

export interface DesktopHarnessDevice {
  id: string
  tenantId: string
  userId: string
  deviceId: string
  deviceName: string
  os: string
  architecture: string
  harnessVersion: string
  bridgeVersion: string
  protocolVersions: string[]
  capabilities: string[]
  channel: 'canary' | 'stable' | 'enterprise-lts'
  lastSeenAt: string
  status: 'online' | 'offline' | 'disabled' | 'revoked' | 'update-required'
  createdAt: string
  current: boolean
}

export interface DesktopWorkspaceDefinitionInput {
  name: string
  enabled: boolean
  priority: number
  targets: { roles?: string[]; userIds?: string[]; groups?: string[] }
  branding: { productName: string; logoRef?: string; accent?: string }
  navigation: DesktopNavigationItem[]
  contextPane: DesktopResolvedWorkspace['contextPane']
  homeRoute: string
}

export type DesktopWorkloadKind = 'action' | 'model' | 'mcp' | 'workflow' | 'task' | 'sync' | 'agent'
export type DesktopEnvironmentRuntimeState = 'active' | 'draining' | 'maintenance' | 'disabled'
export type DesktopMaintenanceTaskType = 'reconcile' | 'cleanup' | 'compact' | 'update'
export type DesktopMaintenanceTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface DesktopEnvironmentOperationsState {
  tenantId: string
  environmentId: string
  state: DesktopEnvironmentRuntimeState
  reason?: string
  version: number
  updatedBy: string
  updatedAt: string
}

export interface DesktopEnvironmentQuotaPolicy {
  tenantId: string
  environmentId: string
  maxConcurrent: Partial<Record<DesktopWorkloadKind, number>>
  startsPerMinute: Partial<Record<DesktopWorkloadKind, number>>
  maxConcurrentTotal?: number
  maxMaintenanceTasks: number
  version: number
  updatedBy: string
  updatedAt: string
}

export interface DesktopEnvironmentUsageSnapshot {
  tenantId: string
  environmentId: string
  active: Partial<Record<DesktopWorkloadKind, number>>
  activeTotal: number
  minuteBucket: string
  startsThisMinute: Partial<Record<DesktopWorkloadKind, number>>
  updatedAt: string
}

export interface DesktopMaintenanceTask {
  id: string
  tenantId: string
  environmentId: string
  type: DesktopMaintenanceTaskType
  status: DesktopMaintenanceTaskStatus
  requestedBy: string
  reason?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface DesktopOperationsSnapshot {
  state: DesktopEnvironmentOperationsState
  quota: DesktopEnvironmentQuotaPolicy
  usage: DesktopEnvironmentUsageSnapshot
  maintenance: DesktopMaintenanceTask[]
}

export interface DesktopApprovalStageSummary {
  id: string
  name?: string
  quorum: number
  rejectMode: 'any' | 'quorum'
  rejectQuorum?: number
  eligibleUsers: string[]
  eligibleRoles: string[]
  eligibleGroups: string[]
  approvals: number
  rejections: number
}

export interface DesktopApprovalSummary {
  id: string
  tenantId: string
  environmentId: string
  requesterId: string
  gate: string
  action: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
  version: number
  createdAt: string
  updatedAt?: string
  escalationCount?: number
  currentStage: DesktopApprovalStageSummary
  [key: string]: unknown
}

export interface DesktopApprovalInbox {
  waitingForMe: DesktopApprovalSummary[]
  requestedByMe: DesktopApprovalSummary[]
  escalated: DesktopApprovalSummary[]
  completed: DesktopApprovalSummary[]
  expired: DesktopApprovalSummary[]
}

export interface DesktopApprovalDecisionInput {
  approvalId: string
  environmentId: string
  expectedVersion: number
  decision: 'approve' | 'reject'
  comment?: string
}

export interface DesktopApprovalDecisionResult {
  status: string
  approval?: DesktopApprovalSummary
}

export interface DesktopEnvironmentTransitionInput {
  environmentId: string
  to: DesktopEnvironmentRuntimeState
  reason?: string
}

export interface DesktopMaintenanceRequestInput {
  environmentId: string
  type: DesktopMaintenanceTaskType
  reason?: string
}

export interface DesktopModelBudgetPolicy {
  id: string
  tenantId: string
  environmentId: string
  projectId?: string
  monthlyBudgetUsd: number
  dailyBudgetUsd?: number
  maxRequestUsd?: number
  dailyTokenLimit?: number
  warningPercent: number
  hardLimit: boolean
  enabled: boolean
}

export interface DesktopModelUsageTotals {
  costUsd: number
  inputTokens: number
  outputTokens: number
  requests: number
}

export interface DesktopModelBudgetState {
  policy: DesktopModelBudgetPolicy
  monthly: DesktopModelUsageTotals
  daily: DesktopModelUsageTotals
  remainingUsd: number
  warning: boolean
}

export interface DesktopModelBudgetSummary {
  month: { from: string; to: string }
  day: { from: string; to: string }
  items: DesktopModelBudgetState[]
}

export interface DesktopModelUsageRecord {
  id: string
  tenantId: string
  environmentId: string
  projectId?: string
  routeId: string
  providerProfileId: string
  modelId: string
  actorId: string
  requestId: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
  status: 'succeeded' | 'failed'
  traceId?: string
  createdAt: string
}

export type DesktopOverviewSection<T> =
  | { available: true; value: T }
  | { available: false; status?: number; error: string }

export interface DesktopEnterpriseOverview {
  environmentId: string
  projectId?: string
  fetchedAt: string
  operations: DesktopOverviewSection<DesktopOperationsSnapshot>
  approvals: DesktopOverviewSection<DesktopApprovalInbox>
  modelBudget: DesktopOverviewSection<DesktopModelBudgetSummary>
  modelUsage: DesktopOverviewSection<DesktopModelUsageRecord[]>
}

export interface DesktopObisIdentityBridge {
  status(): Promise<DesktopObisIdentityStatus>
  configure(configuration: DesktopObisIdentityConfiguration): Promise<DesktopObisIdentityStatus>
  startDeviceAuthorization(): Promise<DesktopObisDeviceAuthorization>
  exchangeDeviceAuthorization(deviceCode: string): Promise<DesktopObisDeviceExchange>
  refresh(): Promise<DesktopObisIdentityStatus>
  logout(): Promise<DesktopObisIdentityStatus>
  context(): Promise<DesktopEnterpriseContext>
  switchTenant(tenantId: string): Promise<DesktopObisIdentityStatus>
  workspace(): Promise<DesktopResolvedWorkspace>
  savePreferences(value: Pick<DesktopUserPreference, 'pinnedIds' | 'hiddenOptionalIds' | 'navigationOrder' | 'defaultProjectId' | 'defaultEnvironmentId'>): Promise<DesktopUserPreference>
  devices(): Promise<DesktopHarnessDevice[]>
  revokeDevice(installationId: string): Promise<void>
  listWorkspaceDefinitions(): Promise<unknown[]>
  saveWorkspaceDefinition(id: string, value: DesktopWorkspaceDefinitionInput): Promise<unknown>
  overview(scope: { environmentId: string; projectId?: string }): Promise<DesktopEnterpriseOverview>
  decideApproval(input: DesktopApprovalDecisionInput): Promise<DesktopApprovalDecisionResult>
  transitionEnvironment(input: DesktopEnvironmentTransitionInput): Promise<DesktopEnvironmentOperationsState>
  requestMaintenance(input: DesktopMaintenanceRequestInput): Promise<DesktopMaintenanceTask>
}

declare global {
  interface Window {
    dshEnterprise: DesktopObisIdentityBridge
  }
}
