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

export interface DesktopObisIdentityBridge {
  status(): Promise<DesktopObisIdentityStatus>
  configure(configuration: DesktopObisIdentityConfiguration): Promise<DesktopObisIdentityStatus>
  startDeviceAuthorization(): Promise<DesktopObisDeviceAuthorization>
  exchangeDeviceAuthorization(deviceCode: string): Promise<DesktopObisDeviceExchange>
  refresh(): Promise<DesktopObisIdentityStatus>
  logout(): Promise<DesktopObisIdentityStatus>
}

declare global {
  interface Window {
    dshEnterprise: DesktopObisIdentityBridge
  }
}
