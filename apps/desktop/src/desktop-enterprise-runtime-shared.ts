export interface EnterpriseRuntimeScopeRequest {
  projectId: string
  environmentId: string
}

/**
 * The validated enterprise authority carried by one Desktop runtime.
 *
 * Renderer code may request a project/environment switch, but it never gets to
 * author tenant, installation, or user authority. Electron Main obtains those
 * fields from the authenticated OBIS identity and accepts this structure only
 * after the OBIS scope validation endpoint returns the exact same authority.
 */
export interface EnterpriseRuntimeScope {
  tenantId: string
  projectId: string
  environmentId: string
  installationId: string
  userId: string
}

/** Backwards-compatible Desktop-prefixed names used by the current shell. */
export type DesktopEnterpriseScopeRequest = EnterpriseRuntimeScopeRequest
export type DesktopEnterpriseRuntimeScope = EnterpriseRuntimeScope

function segment(value: string): string {
  return encodeURIComponent(value.trim())
}

/** Stable, filesystem-safe namespace for enterprise-owned local data. */
export function enterpriseScopeNamespace(scope: EnterpriseRuntimeScope): string {
  return [
    'tenant', segment(scope.tenantId),
    'project', segment(scope.projectId),
    'environment', segment(scope.environmentId),
  ].join('/')
}

/** Stable namespace for data owned by one enterprise session. */
export function enterpriseSessionNamespace(scope: EnterpriseRuntimeScope, sessionId: string): string {
  return `${enterpriseScopeNamespace(scope)}/session/${segment(sessionId)}`
}

export function sameEnterpriseRuntimeScope(
  left: EnterpriseRuntimeScope | undefined,
  right: EnterpriseRuntimeScope | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.tenantId === right.tenantId
    && left.projectId === right.projectId
    && left.environmentId === right.environmentId
    && left.installationId === right.installationId
    && left.userId === right.userId
}
