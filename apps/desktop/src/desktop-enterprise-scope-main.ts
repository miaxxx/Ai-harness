import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { DesktopEnterpriseRuntimeScope } from './desktop-enterprise-runtime-shared.ts'

interface SessionOwnershipRecord extends DesktopEnterpriseRuntimeScope {
  sessionId: string
  cwd: string
  claimedAt: string
}

interface SessionOwnershipFile {
  version: 2
  records: SessionOwnershipRecord[]
}

let activeScope: DesktopEnterpriseRuntimeScope | undefined
let ownershipCache: Map<string, SessionOwnershipRecord> | undefined

function filePath(): string {
  return join(app.getPath('userData'), 'enterprise-session-ownership.json')
}

function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Enterprise runtime scope requires ${label}.`)
  return normalized
}

function isOwnershipRecord(value: unknown): value is SessionOwnershipRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Partial<SessionOwnershipRecord>
  return typeof row.sessionId === 'string'
    && typeof row.cwd === 'string'
    && typeof row.tenantId === 'string'
    && typeof row.projectId === 'string'
    && typeof row.environmentId === 'string'
    && typeof row.installationId === 'string'
    && typeof row.userId === 'string'
}

export function setEnterpriseRuntimeScope(value: DesktopEnterpriseRuntimeScope | undefined): void {
  if (!value) {
    activeScope = undefined
    delete process.env.OBIS_TENANT_ID
    delete process.env.OBIS_PROJECT_ID
    delete process.env.OBIS_ENVIRONMENT_ID
    delete process.env.OBIS_INSTALLATION_ID
    delete process.env.OBIS_DESKTOP_TENANT_ID
    delete process.env.OBIS_DESKTOP_PROJECT_ID
    delete process.env.OBIS_DESKTOP_ENVIRONMENT_ID
    return
  }

  activeScope = {
    tenantId: required(value.tenantId, 'tenantId'),
    projectId: required(value.projectId, 'projectId'),
    environmentId: required(value.environmentId, 'environmentId'),
    installationId: required(value.installationId, 'installationId'),
    userId: required(value.userId, 'userId'),
  }

  process.env.OBIS_TENANT_ID = activeScope.tenantId
  process.env.OBIS_PROJECT_ID = activeScope.projectId
  process.env.OBIS_ENVIRONMENT_ID = activeScope.environmentId
  process.env.OBIS_INSTALLATION_ID = activeScope.installationId
}

export function enterpriseRuntimeScope(): DesktopEnterpriseRuntimeScope | undefined {
  return activeScope ? { ...activeScope } : undefined
}

function sameScope(owner: SessionOwnershipRecord, scope: DesktopEnterpriseRuntimeScope): boolean {
  return owner.tenantId === scope.tenantId
    && owner.projectId === scope.projectId
    && owner.environmentId === scope.environmentId
    && owner.installationId === scope.installationId
    && owner.userId === scope.userId
}

async function ownership(): Promise<Map<string, SessionOwnershipRecord>> {
  if (ownershipCache) return ownershipCache

  const map = new Map<string, SessionOwnershipRecord>()
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf8')) as Partial<SessionOwnershipFile>
    if (parsed.version === 2 && Array.isArray(parsed.records)) {
      for (const value of parsed.records) {
        if (!isOwnershipRecord(value)) continue
        map.set(value.sessionId, {
          ...value,
          claimedAt: typeof value.claimedAt === 'string' ? value.claimedAt : new Date(0).toISOString(),
        })
      }
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      console.warn('[enterprise-scope] failed to read session ownership ledger:', error)
    }
  }

  ownershipCache = map
  return map
}

async function persist(map: Map<string, SessionOwnershipRecord>): Promise<void> {
  const path = filePath()
  const temporary = `${path}.tmp`
  const payload: SessionOwnershipFile = {
    version: 2,
    records: [...map.values()].sort((left, right) => left.claimedAt.localeCompare(right.claimedAt)),
  }

  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export async function claimEnterpriseSession(sessionId: string, cwd: string): Promise<void> {
  const scope = enterpriseRuntimeScope()
  if (!scope) return

  const map = await ownership()
  const existing = map.get(sessionId)
  if (existing && !sameScope(existing, scope)) {
    throw new Error('Enterprise session is already owned by another validated runtime scope.')
  }
  if (existing) return

  map.set(sessionId, {
    sessionId,
    cwd,
    ...scope,
    claimedAt: new Date().toISOString(),
  })
  await persist(map)
}

export async function canAccessEnterpriseSession(sessionId: string): Promise<boolean> {
  const scope = enterpriseRuntimeScope()
  if (!scope) return true
  const owner = (await ownership()).get(sessionId)
  return owner !== undefined && sameScope(owner, scope)
}

export async function filterEnterpriseSessions<T extends { sessionId: string }>(
  values: readonly T[],
): Promise<T[]> {
  const scope = enterpriseRuntimeScope()
  if (!scope) return [...values]
  const map = await ownership()
  return values.filter((value) => {
    const owner = map.get(value.sessionId)
    return owner !== undefined && sameScope(owner, scope)
  })
}

export async function assertEnterpriseSessionAccess(sessionId: string): Promise<void> {
  if (!await canAccessEnterpriseSession(sessionId)) {
    throw new Error('Enterprise session access denied for the active validated runtime scope.')
  }
}
