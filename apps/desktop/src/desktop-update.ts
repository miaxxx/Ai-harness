import type { DesktopReleaseChannel, DesktopUpdatePolicy } from './desktop-update-shared.ts'

export interface DesktopUpdateDecision {
  allowed: boolean
  mandatory: boolean
  reason?: string
}

function semverParts(value: string): [number, number, number, string] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? '']
}

export function compareDesktopVersions(left: string, right: string): number {
  const a = semverParts(left)
  const b = semverParts(right)
  if (!a || !b) throw new Error(`Invalid semantic version comparison: ${left} / ${right}`)
  for (let index = 0; index < 3; index += 1) {
    const delta = a[index] as number - (b[index] as number)
    if (delta !== 0) return delta < 0 ? -1 : 1
  }
  if (a[3] === b[3]) return 0
  if (!a[3]) return 1
  if (!b[3]) return -1
  return a[3].localeCompare(b[3], undefined, { numeric: true })
}

export function releaseChannelForVersion(version: string): DesktopReleaseChannel {
  const suffix = semverParts(version)?.[3] ?? ''
  if (/enterprise[-.]?lts/i.test(suffix)) return 'enterprise-lts'
  if (/canary/i.test(suffix)) return 'canary'
  if (/beta|rc/i.test(suffix)) return 'beta'
  return 'stable'
}

export function isDesktopReleaseChannel(value: unknown): value is DesktopReleaseChannel {
  return value === 'canary' || value === 'beta' || value === 'stable' || value === 'enterprise-lts'
}

export function evaluateDesktopUpdate(
  currentVersion: string,
  availableVersion: string,
  policy: DesktopUpdatePolicy,
): DesktopUpdateDecision {
  if (policy.mode === 'disabled') return { allowed: false, mandatory: false, reason: 'Enterprise policy disables Desktop updates.' }
  if (policy.blockedVersions.includes(availableVersion)) return { allowed: false, mandatory: false, reason: 'The available Desktop version is blocked by enterprise policy.' }
  if (policy.pinnedVersion && availableVersion !== policy.pinnedVersion) {
    return { allowed: false, mandatory: false, reason: `Enterprise policy pins Desktop to ${policy.pinnedVersion}.` }
  }
  const comparison = compareDesktopVersions(availableVersion, currentVersion)
  if (comparison === 0) return { allowed: false, mandatory: false, reason: 'Desktop is already on this version.' }
  if (comparison < 0 && policy.allowDowngrade !== true) return { allowed: false, mandatory: false, reason: 'Desktop downgrade is not authorized by enterprise policy.' }

  const availableChannel = releaseChannelForVersion(availableVersion)
  if (policy.mode === 'stable-only' && availableChannel !== 'stable') {
    return { allowed: false, mandatory: false, reason: 'Enterprise policy permits stable releases only.' }
  }
  if (policy.releaseChannel === 'stable' && availableChannel !== 'stable') {
    return { allowed: false, mandatory: false, reason: 'The release does not belong to the configured stable channel.' }
  }
  if (policy.releaseChannel === 'beta' && availableChannel === 'canary') {
    return { allowed: false, mandatory: false, reason: 'Canary releases are outside the configured beta channel.' }
  }
  if (policy.releaseChannel === 'enterprise-lts' && availableChannel !== 'enterprise-lts') {
    return { allowed: false, mandatory: false, reason: 'Only enterprise LTS releases are authorized.' }
  }

  const mandatory = policy.minimumVersion !== undefined
    && compareDesktopVersions(currentVersion, policy.minimumVersion) < 0
  return { allowed: true, mandatory }
}

export type RemoteDesktopUpdatePolicy = Partial<Pick<
  DesktopUpdatePolicy,
  'minimumVersion' | 'recommendedVersion' | 'latestVersion' | 'blockedVersions' | 'releaseChannel'
>>

export function mergeDesktopUpdatePolicy(
  local: DesktopUpdatePolicy,
  remote: RemoteDesktopUpdatePolicy,
): DesktopUpdatePolicy {
  return {
    ...local,
    ...(remote.minimumVersion ? { minimumVersion: remote.minimumVersion } : {}),
    ...(remote.recommendedVersion ? { recommendedVersion: remote.recommendedVersion } : {}),
    ...(remote.latestVersion ? { latestVersion: remote.latestVersion } : {}),
    ...(remote.releaseChannel ? { releaseChannel: remote.releaseChannel } : {}),
    blockedVersions: [...new Set([...local.blockedVersions, ...(remote.blockedVersions ?? [])])],
  }
}

export function parseDesktopUpdatePolicy(env: NodeJS.ProcessEnv): DesktopUpdatePolicy {
  const mode = env.OBIS_DESKTOP_UPDATE_MODE?.trim()
  const releaseChannel = env.OBIS_DESKTOP_UPDATE_CHANNEL?.trim()
  const normalizedMode: DesktopUpdatePolicy['mode'] = mode === 'automatic' || mode === 'stable-only' || mode === 'manual-approval' || mode === 'pinned' || mode === 'disabled'
    ? mode
    : 'manual-approval'
  const normalizedChannel: DesktopReleaseChannel = isDesktopReleaseChannel(releaseChannel)
    ? releaseChannel
    : 'stable'
  const blockedVersions = (env.OBIS_DESKTOP_BLOCKED_VERSIONS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return {
    mode: normalizedMode,
    releaseChannel: normalizedChannel,
    ...(env.OBIS_DESKTOP_MINIMUM_VERSION?.trim() ? { minimumVersion: env.OBIS_DESKTOP_MINIMUM_VERSION.trim() } : {}),
    ...(env.OBIS_DESKTOP_RECOMMENDED_VERSION?.trim() ? { recommendedVersion: env.OBIS_DESKTOP_RECOMMENDED_VERSION.trim() } : {}),
    ...(env.OBIS_DESKTOP_LATEST_VERSION?.trim() ? { latestVersion: env.OBIS_DESKTOP_LATEST_VERSION.trim() } : {}),
    ...(env.OBIS_DESKTOP_PINNED_VERSION?.trim() ? { pinnedVersion: env.OBIS_DESKTOP_PINNED_VERSION.trim() } : {}),
    blockedVersions,
    allowDowngrade: env.OBIS_DESKTOP_ALLOW_DOWNGRADE?.trim() === '1',
  }
}
