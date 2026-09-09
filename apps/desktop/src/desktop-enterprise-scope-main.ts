import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

export interface DesktopEnterpriseRuntimeScope {
  tenantId: string
  projectId?: string
  environmentId?: string
}

interface SessionOwnershipRecord extends DesktopEnterpriseRuntimeScope {
  sessionId: string
  cwd: string
  claimedAt: string
}

interface SessionOwnershipFile {
  version: 1
  records: SessionOwnershipRecord[]
}

let activeScope: DesktopEnterpriseRuntimeScope | undefined
let ownershipCache: Map<string, SessionOwnershipRecord> | undefined

function filePath(): string { return join(app.getPath('userData'), 'enterprise-session-ownership.json') }
function clean(value: string | undefined): string | undefined { const normalized=value?.trim(); return normalized ? normalized : undefined }

export function setEnterpriseRuntimeScope(value: DesktopEnterpriseRuntimeScope | undefined): void {
  if (!value) {
    activeScope = undefined
    delete process.env.OBIS_DESKTOP_TENANT_ID
    delete process.env.OBIS_DESKTOP_PROJECT_ID
    delete process.env.OBIS_DESKTOP_ENVIRONMENT_ID
    return
  }
  const tenantId=clean(value.tenantId)
  if (!tenantId) throw new Error('Enterprise runtime scope requires tenantId.')
  activeScope={ tenantId,...(clean(value.projectId)?{ projectId:clean(value.projectId) }:{}),...(clean(value.environmentId)?{ environmentId:clean(value.environmentId) }:{}) }
  process.env.OBIS_DESKTOP_TENANT_ID=tenantId
  if(activeScope.projectId)process.env.OBIS_DESKTOP_PROJECT_ID=activeScope.projectId;else delete process.env.OBIS_DESKTOP_PROJECT_ID
  if(activeScope.environmentId)process.env.OBIS_DESKTOP_ENVIRONMENT_ID=activeScope.environmentId;else delete process.env.OBIS_DESKTOP_ENVIRONMENT_ID
}

export function enterpriseRuntimeScope(): DesktopEnterpriseRuntimeScope | undefined {
  return activeScope ? { ...activeScope } : undefined
}

function sameScope(owner: SessionOwnershipRecord, scope: DesktopEnterpriseRuntimeScope): boolean {
  return owner.tenantId===scope.tenantId
    && (owner.projectId??'')===(scope.projectId??'')
    && (owner.environmentId??'')===(scope.environmentId??'')
}

async function ownership(): Promise<Map<string, SessionOwnershipRecord>> {
  if (ownershipCache) return ownershipCache
  const map=new Map<string,SessionOwnershipRecord>()
  try {
    const parsed=JSON.parse(await readFile(filePath(),'utf8')) as Partial<SessionOwnershipFile>
    if(parsed.version===1&&Array.isArray(parsed.records)){
      for(const value of parsed.records){
        if(!value||typeof value!=='object'||typeof value.sessionId!=='string'||typeof value.cwd!=='string'||typeof value.tenantId!=='string')continue
        map.set(value.sessionId,{ sessionId:value.sessionId,cwd:value.cwd,tenantId:value.tenantId,...(typeof value.projectId==='string'&&value.projectId?{ projectId:value.projectId }:{}),...(typeof value.environmentId==='string'&&value.environmentId?{ environmentId:value.environmentId }:{}),claimedAt:typeof value.claimedAt==='string'?value.claimedAt:new Date(0).toISOString() })
      }
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) console.warn('[enterprise-scope] failed to read session ownership ledger:',error)
  }
  ownershipCache=map
  return map
}

async function persist(map: Map<string, SessionOwnershipRecord>): Promise<void> {
  const path=filePath(),temporary=`${path}.tmp`,payload:SessionOwnershipFile={ version:1,records:[...map.values()].sort((a,b)=>a.claimedAt.localeCompare(b.claimedAt)) }
  await mkdir(app.getPath('userData'),{ recursive:true })
  await writeFile(temporary,`${JSON.stringify(payload,null,2)}\n`,{ mode:0o600 })
  await rename(temporary,path)
}

export async function claimEnterpriseSession(sessionId:string,cwd:string):Promise<void>{
  const scope=enterpriseRuntimeScope()
  if(!scope)return
  const map=await ownership(),existing=map.get(sessionId)
  if(existing&&!sameScope(existing,scope))throw new Error('Enterprise session is already owned by another tenant/project/environment scope.')
  if(existing)return
  map.set(sessionId,{ sessionId,cwd,...scope,claimedAt:new Date().toISOString() })
  await persist(map)
}

export async function canAccessEnterpriseSession(sessionId:string):Promise<boolean>{
  const scope=enterpriseRuntimeScope()
  if(!scope)return true
  const owner=(await ownership()).get(sessionId)
  return owner!==undefined&&sameScope(owner,scope)
}

export async function filterEnterpriseSessions<T extends { sessionId:string }>(values:readonly T[]):Promise<T[]>{
  const scope=enterpriseRuntimeScope()
  if(!scope)return [...values]
  const map=await ownership()
  return values.filter((value)=>{const owner=map.get(value.sessionId);return owner!==undefined&&sameScope(owner,scope)})
}

export async function assertEnterpriseSessionAccess(sessionId:string):Promise<void>{
  if(!await canAccessEnterpriseSession(sessionId))throw new Error('Enterprise session access denied for the active tenant/project/environment scope.')
}
