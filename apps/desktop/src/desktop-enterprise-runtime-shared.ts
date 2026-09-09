import type { DesktopObisIdentityBridge } from './desktop-obis-identity-shared.ts'

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

declare module './desktop-obis-identity-shared.ts' {
  interface DesktopObisIdentityBridge {
    validateRuntimeScope(input: DesktopEnterpriseScopeRequest): Promise<DesktopEnterpriseRuntimeScope>
  }
}

export type DesktopEnterpriseRuntimeBridge = Pick<DesktopObisIdentityBridge, 'validateRuntimeScope'>
