export type DesktopReleaseChannel = 'canary' | 'beta' | 'stable' | 'enterprise-lts'
export type DesktopUpdatePolicyMode = 'automatic' | 'stable-only' | 'manual-approval' | 'pinned' | 'disabled'
export type DesktopUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'blocked' | 'error'

export interface DesktopUpdatePolicy {
  mode: DesktopUpdatePolicyMode
  releaseChannel: DesktopReleaseChannel
  minimumVersion?: string
  recommendedVersion?: string
  latestVersion?: string
  pinnedVersion?: string
  blockedVersions: string[]
  allowDowngrade?: boolean
}

export interface DesktopUpdateState {
  phase: DesktopUpdatePhase
  currentVersion: string
  channel: DesktopReleaseChannel
  availableVersion?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  mandatory: boolean
  reason?: string
  checkedAt?: string
  downloadedAt?: string
  error?: string
}

export interface DesktopUpdateBridge {
  state(): Promise<DesktopUpdateState>
  check(): Promise<DesktopUpdateState>
  download(): Promise<DesktopUpdateState>
  install(): Promise<void>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}

declare global {
  interface Window {
    dshDesktopUpdate: DesktopUpdateBridge
  }
}
