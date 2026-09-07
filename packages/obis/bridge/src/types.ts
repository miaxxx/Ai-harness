export const OHP_VERSION = '1.0' as const

export interface OhpCapabilities {
  protocolVersions: string[]
  kernelVersion: string
  irVersions: string[]
  capabilities: string[]
  minimumHarnessVersion?: string
  recommendedHarnessVersion?: string
  blockedHarnessVersions: string[]
}

export interface HarnessRegistration {
  deviceId: string
  deviceName: string
  os: string
  architecture: string
  harnessVersion: string
  bridgeVersion: string
  protocolVersions: string[]
  capabilities: string[]
  channel: 'canary' | 'stable' | 'enterprise-lts'
}

export interface HarnessInstallation extends HarnessRegistration {
  id: string
  tenantId: string
  userId: string
  lastSeenAt: string
  createdAt: string
  status: 'online' | 'offline' | 'disabled' | 'revoked' | 'update-required'
}

export interface CompatibilityResult {
  compatible: boolean
  updateRequired: boolean
  warnings: string[]
  selectedProtocolVersion?: string
  missingCapabilities?: string[]
}

export interface CapabilityLease {
  id: string
  runId: string
  deploymentId: string
  tenantId: string
  environmentId: string
  userId: string
  deviceId: string
  operations: string[]
  issuedAt: string
  expiresAt: string
}

export interface AgentRunBinding {
  id: string
  tenantId: string
  environmentId: string
  actorId: string
  taskId: string
  deploymentId: string
  artifactId: string
  status: string
  version: number
  autonomy: string
  harnessSessionId?: string
  installationId?: string
  capabilityLease?: CapabilityLease
  [key: string]: unknown
}

export interface OhpErrorBody {
  error: {
    code: string
    message: string
    correlationId: string
    retryable: boolean
    details?: Record<string, unknown>
  }
}

export interface OhpRunEvent {
  id: string
  type: 'run.started' | 'planning' | 'query.started' | 'query.completed' | 'proposal.created' | 'approval.required' | 'approval.approved' | 'action.started' | 'action.completed' | 'run.completed' | 'run.failed'
  runId: string
  occurredAt: string
  correlationId: string
  data?: Record<string, unknown>
}

export type JsonRecord = Record<string, unknown>
