export interface DesktopEnterpriseScopeRequest {
  projectId: string
  environmentId: string
}

export interface DesktopEnterpriseRuntimeScope {
  tenantId: string
  projectId: string
  environmentId: string
  installationId: string
  userId: string
}
