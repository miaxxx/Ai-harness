export interface DesktopObisMembership { tenantId:string;roles:string[];status:string; }
export interface DesktopObisIdentityStatus {configured:boolean;required:boolean;authenticated:boolean;baseURL?:string;tenantId?:string;deviceId?:string;expiresAt?:string;refreshExpiresAt?:string;user?:{id:string;displayName:string;primaryEmail?:string};membership?:DesktopObisMembership;memberships?:DesktopObisMembership[];}
export interface DesktopObisIdentityConfiguration {baseURL:string;tenantId:string;}
export interface DesktopObisDeviceAuthorization {deviceCode:string;userCode:string;verificationUri:string;expiresInSeconds:number;intervalSeconds:number;}
export type DesktopObisDeviceExchange={status:'authorization_pending'|'slow_down';retryAfterSeconds?:number}|{status:'authenticated';identity:DesktopObisIdentityStatus};
export interface DesktopEnterpriseEnvironment {id:string;tenantId:string;name:string;kind:'development'|'staging'|'production'|'custom';status:'active'|'disabled';createdAt:string;}
export interface DesktopEnterpriseProject {id:string;tenantId:string;name:string;description?:string;createdAt:string;}
export interface DesktopEnterpriseTenantContext {id:string;displayName:string;roles:string[];projects:DesktopEnterpriseProject[];environments:DesktopEnterpriseEnvironment[];}
export interface DesktopEnterpriseContext {currentTenantId:string;user:{id:string;displayName:string;primaryEmail?:string};deviceId:string|null;tenants:DesktopEnterpriseTenantContext[];}
export type DesktopNavKind='new-task'|'team'|'assistants'|'skills'|'automation'|'knowledge'|'operations'|'module'|'custom';
export interface DesktopNavigationItem {id:string;label:string;kind:DesktopNavKind;route:string;icon?:string;section?:string;order:number;requiredRoles?:string[];optional?:boolean;moduleId?:string;}
export interface DesktopUserPreference {tenantId:string;userId:string;pinnedIds:string[];hiddenOptionalIds:string[];navigationOrder:string[];defaultProjectId?:string;defaultEnvironmentId?:string;version:number;updatedAt:string;}
export interface DesktopResolvedWorkspace {shellVersion:1;definitionId:string;definitionVersion:number;branding:{productName:string;logoRef?:string;accent?:string};navigation:DesktopNavigationItem[];contextPane:{mode:'none'|'team'|'assistants'|'spaces'|'module';title?:string;moduleId?:string};homeRoute:string;preferences:DesktopUserPreference;customization:{enterpriseManaged:true;canManageEnterprise:boolean;userMayReorder:true;userMayHideOptional:true};}
export interface DesktopHarnessDevice {id:string;tenantId:string;userId:string;deviceId:string;deviceName:string;os:string;architecture:string;harnessVersion:string;bridgeVersion:string;protocolVersions:string[];capabilities:string[];channel:'canary'|'stable'|'enterprise-lts';lastSeenAt:string;status:'online'|'offline'|'disabled'|'revoked'|'update-required';createdAt:string;current:boolean;}
export interface DesktopWorkspaceDefinitionInput {name:string;enabled:boolean;priority:number;targets:{roles?:string[];userIds?:string[];groups?:string[]};branding:{productName:string;logoRef?:string;accent?:string};navigation:DesktopNavigationItem[];contextPane:DesktopResolvedWorkspace['contextPane'];homeRoute:string;}
export interface DesktopObisIdentityBridge {
  status():Promise<DesktopObisIdentityStatus>;
  configure(configuration:DesktopObisIdentityConfiguration):Promise<DesktopObisIdentityStatus>;
  startDeviceAuthorization():Promise<DesktopObisDeviceAuthorization>;
  exchangeDeviceAuthorization(deviceCode:string):Promise<DesktopObisDeviceExchange>;
  refresh():Promise<DesktopObisIdentityStatus>;
  logout():Promise<DesktopObisIdentityStatus>;
  context():Promise<DesktopEnterpriseContext>;
  switchTenant(tenantId:string):Promise<DesktopObisIdentityStatus>;
  workspace():Promise<DesktopResolvedWorkspace>;
  savePreferences(value:Pick<DesktopUserPreference,'pinnedIds'|'hiddenOptionalIds'|'navigationOrder'|'defaultProjectId'|'defaultEnvironmentId'>):Promise<DesktopUserPreference>;
  devices():Promise<DesktopHarnessDevice[]>;
  revokeDevice(installationId:string):Promise<void>;
  listWorkspaceDefinitions():Promise<unknown[]>;
  saveWorkspaceDefinition(id:string,value:DesktopWorkspaceDefinitionInput):Promise<unknown>;
}
declare global {interface Window {dshEnterprise:DesktopObisIdentityBridge;}}
