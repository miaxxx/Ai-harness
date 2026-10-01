/** Wire version sent on governed Harness requests. */
export const OHP_VERSION = '1.0' as const

/** Kernel protocol, capability and client version requirements. */
export interface OhpCapabilities {
  protocolVersions: string[]
  kernelVersion: string
  irVersions: string[]
  capabilities: string[]
  minimumHarnessVersion?: string
  recommendedHarnessVersion?: string
  blockedHarnessVersions: string[]
}

/** Device identity and supported Harness protocols advertised during registration. */
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

/** Public Harness installation. Omits tenant identifiers. */
export interface HarnessInstallation extends HarnessRegistration {
  id: string
  userId: string
  lastSeenAt: string
  createdAt: string
  status: 'online' | 'offline' | 'disabled' | 'revoked' | 'update-required'
}

/** Kernel decision for an installation's advertised versions and capabilities. */
export interface CompatibilityResult {
  compatible: boolean
  updateRequired: boolean
  warnings: string[]
  selectedProtocolVersion?: string
  missingCapabilities?: string[]
}

/** Public capability lease. Omits tenant identifiers. */
export interface CapabilityLease {
  id: string
  runId: string
  deploymentId: string
  environmentId: string
  userId: string
  deviceId: string
  operations: string[]
  issuedAt: string
  expiresAt: string
}

/** Public AgentRun binding. Omits tenant identifiers. */
export interface AgentRunBinding {
  id: string
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

/** Public Kernel error fields used for request tracing and retry decisions. */
export interface OhpErrorBody {
  error: {
    code: string
    message: string
    correlationId: string
    retryable: boolean
    details?: Record<string, unknown>
  }
}

/** Public SSE event identifying its AgentRun and correlation record. */
export interface OhpRunEvent {
  id: string
  type: 'run.started' | 'planning' | 'query.started' | 'query.completed' | 'proposal.created' | 'approval.required' | 'approval.approved' | 'action.started' | 'action.completed' | 'run.completed' | 'run.failed'
  runId: string
  occurredAt: string
  correlationId: string
  data?: Record<string, unknown>
}

/** JSON object fields received from or submitted to Kernel APIs. */
export type JsonRecord = Record<string, unknown>
