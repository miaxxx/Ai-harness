import type { DesktopEnterpriseScopeRequest } from './desktop-enterprise-runtime-shared.ts'
import type { DesktopNavigationItem } from './desktop-obis-identity-shared.ts'

export interface DesktopApplicationNavigationRecord {
  id: string
  label: string
  page: string
  group?: string
  moduleId: string
  moduleVersion: string
}

export interface DesktopApplicationUiNode {
  component: string
  id?: string
  tokenRefs?: string[]
  props?: Record<string, unknown>
  children?: DesktopApplicationUiNode[]
}

export interface DesktopApplicationPageSchema {
  id: string
  title: string
  pattern?: string
  layout: DesktopApplicationUiNode
  source?: { query: string }
  actions?: string[]
}

export interface DesktopApplicationPermissionDecision {
  moduleId: string
  moduleVersion: string
  visible: boolean
  executable: boolean
  configurable: boolean
  editable: boolean
  administerable: boolean
  reasons: string[]
}

export interface DesktopApplicationPageEnvelope {
  module: { id: string; version: string; name: string }
  page: DesktopApplicationPageSchema
  designSystem: { id: string; version: string }
  permissions: DesktopApplicationPermissionDecision
}

export interface DesktopApplicationPageRequest extends DesktopEnterpriseScopeRequest {
  moduleId: string
  pageId: string
}

export interface DesktopModuleNavigationItem extends DesktopNavigationItem {
  kind: 'module'
  moduleId: string
  modulePageId: string
  moduleVersion: string
}

export interface DesktopApplicationBridge {
  navigation(scope: DesktopEnterpriseScopeRequest): Promise<DesktopApplicationNavigationRecord[]>
  page(input: DesktopApplicationPageRequest): Promise<DesktopApplicationPageEnvelope>
}

declare global {
  interface Window {
    dshApplications: DesktopApplicationBridge
  }
}
