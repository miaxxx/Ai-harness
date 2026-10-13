import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => native.root } }))
const scope = { tenantId: 'tenant', projectId: 'project', environmentId: 'test', installationId: 'installation', userId: 'user' }
beforeEach(async () => { vi.resetModules(); native.root = await mkdtemp(join(tmpdir(), 'orbis-ownership-')) })
afterEach(async () => {
  const owner = await import('../src/desktop-enterprise-scope-main.ts')
  owner.setEnterpriseRuntimeScope(undefined)
  vi.unstubAllEnvs()
  await rm(native.root, { recursive: true, force: true })
})
describe('enterprise session admission', () => {
  it('serializes simultaneous claims and publishes every owner only after persistence', async () => {
    const owner = await import('../src/desktop-enterprise-scope-main.ts')
    owner.setEnterpriseRuntimeScope(scope)
    await Promise.all(Array.from({ length: 20 }, (_, index) => owner.claimEnterpriseSession(`session-${index}`, '/workspace')))
    const file = JSON.parse(await readFile(join(native.root, 'enterprise-session-ownership.json'), 'utf8')) as { records: unknown[] }
    expect(file.records).toHaveLength(20)
    expect(await owner.canAccessEnterpriseSession('session-19')).toBe(true)
    owner.setEnterpriseRuntimeScope(undefined)
    expect(await owner.canAccessEnterpriseSession('session-19')).toBe(false)
    expect(await owner.filterEnterpriseSessions([{ sessionId: 'session-19' }, { sessionId: 'local' }])).toEqual([{ sessionId: 'local' }])
  })
  it.each([{ version: 1, records: [] }, { version: 2, records: [{ sessionId: 'invalid' }] }])('rejects unauthenticated access and invalid durable ownership %j', async (invalid) => {
    vi.stubEnv('OBIS_DESKTOP_REQUIRED', '1')
    const owner = await import('../src/desktop-enterprise-scope-main.ts')
    expect(await owner.canAccessEnterpriseSession('local')).toBe(false)
    await expect(owner.claimEnterpriseSession('local', '/workspace')).rejects.toThrow('validated enterprise scope')
    vi.resetModules()
    await writeFile(join(native.root, 'enterprise-session-ownership.json'), JSON.stringify(invalid))
    const malformed = await import('../src/desktop-enterprise-scope-main.ts')
    await expect(malformed.canAccessEnterpriseSession('local')).rejects.toThrow('invalid')
  })
  it('leaves failed claims unowned and admits a later corrected write', async () => {
    const owner = await import('../src/desktop-enterprise-scope-main.ts')
    owner.setEnterpriseRuntimeScope(scope)
    await owner.canAccessEnterpriseSession('missing')
    const root = native.root
    const file = join(root, 'not-a-directory')
    await writeFile(file, '')
    native.root = file
    await expect(owner.claimEnterpriseSession('failed', '/workspace')).rejects.toThrow()
    native.root = root
    expect(await owner.canAccessEnterpriseSession('failed')).toBe(false)
    await owner.claimEnterpriseSession('corrected', '/workspace')
    expect(await owner.canAccessEnterpriseSession('corrected')).toBe(true)
  })
})
