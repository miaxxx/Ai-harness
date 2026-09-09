import { describe, expect, it } from 'vitest'
import {
  compareDesktopVersions,
  evaluateDesktopUpdate,
  mergeDesktopUpdatePolicy,
  parseDesktopUpdatePolicy,
  releaseChannelForVersion,
} from '../src/desktop-update.ts'

const stablePolicy = {
  mode: 'manual-approval' as const,
  releaseChannel: 'stable' as const,
  blockedVersions: [] as string[],
}

describe('desktop update policy', () => {
  it('compares stable and prerelease semantic versions', () => {
    expect(compareDesktopVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareDesktopVersions('1.2.0-rc.1', '1.2.0')).toBe(-1)
    expect(compareDesktopVersions('1.2.0', '1.2.0')).toBe(0)
  })

  it('classifies update channels', () => {
    expect(releaseChannelForVersion('1.0.0')).toBe('stable')
    expect(releaseChannelForVersion('1.0.0-beta.2')).toBe('beta')
    expect(releaseChannelForVersion('1.0.0-canary.4')).toBe('canary')
    expect(releaseChannelForVersion('1.0.0-enterprise-lts.1')).toBe('enterprise-lts')
  })

  it('rejects blocked, disabled and unauthorized downgrade updates', () => {
    expect(evaluateDesktopUpdate('1.0.0', '1.1.0', { ...stablePolicy, mode: 'disabled' }).allowed).toBe(false)
    expect(evaluateDesktopUpdate('1.0.0', '1.1.0', { ...stablePolicy, blockedVersions: ['1.1.0'] }).allowed).toBe(false)
    expect(evaluateDesktopUpdate('1.1.0', '1.0.0', stablePolicy).allowed).toBe(false)
  })

  it('enforces stable-only and pinned policy', () => {
    expect(evaluateDesktopUpdate('1.0.0', '1.1.0-beta.1', { ...stablePolicy, mode: 'stable-only' }).allowed).toBe(false)
    expect(evaluateDesktopUpdate('1.0.0', '1.2.0', { ...stablePolicy, mode: 'pinned', pinnedVersion: '1.1.0' }).allowed).toBe(false)
    expect(evaluateDesktopUpdate('1.0.0', '1.1.0', { ...stablePolicy, mode: 'pinned', pinnedVersion: '1.1.0' }).allowed).toBe(true)
  })

  it('marks updates mandatory when current version is below enterprise minimum', () => {
    const decision = evaluateDesktopUpdate('1.0.0', '1.2.0', { ...stablePolicy, minimumVersion: '1.1.0' })
    expect(decision.allowed).toBe(true)
    expect(decision.mandatory).toBe(true)
  })

  it('merges OBIS compatibility restrictions without dropping local blocks', () => {
    const merged = mergeDesktopUpdatePolicy(
      { ...stablePolicy, blockedVersions: ['1.0.5'] },
      { minimumVersion: '1.1.0', recommendedVersion: '1.2.0', blockedVersions: ['1.1.5'] },
    )
    expect(merged.minimumVersion).toBe('1.1.0')
    expect(merged.recommendedVersion).toBe('1.2.0')
    expect(merged.blockedVersions).toEqual(['1.0.5', '1.1.5'])
  })

  it('parses enterprise update environment policy safely', () => {
    const policy = parseDesktopUpdatePolicy({
      OBIS_DESKTOP_UPDATE_MODE: 'pinned',
      OBIS_DESKTOP_UPDATE_CHANNEL: 'enterprise-lts',
      OBIS_DESKTOP_PINNED_VERSION: '2.0.0-enterprise-lts.1',
      OBIS_DESKTOP_BLOCKED_VERSIONS: '1.0.0, 1.1.0',
      OBIS_DESKTOP_ALLOW_DOWNGRADE: '1',
    })
    expect(policy.mode).toBe('pinned')
    expect(policy.releaseChannel).toBe('enterprise-lts')
    expect(policy.pinnedVersion).toBe('2.0.0-enterprise-lts.1')
    expect(policy.blockedVersions).toEqual(['1.0.0', '1.1.0'])
    expect(policy.allowDowngrade).toBe(true)
  })
})
