import type {
  DesktopApplicationPageSchema,
  DesktopApplicationUiNode,
} from './desktop-application-shared.ts'

export const OBIS_UI_RUNTIME_CONTRACT_VERSION = '0.1.0'
export const OBIS_ENTERPRISE_DESIGN_SYSTEM = { id: 'obis-enterprise', version: '1.0.0' } as const

export const DESKTOP_APPLICATION_COMPONENTS = [
  'Page','Section','Stack','Grid','Form','Table','Tabs','Drawer','Modal','Dashboard','Chart','Detail',
  'Search','Filter','DataTable','ObjectDetail','ObjectPicker','PeoplePicker','ApprovalQueue','Timeline',
  'ActivityFeed','RiskIndicator','AISummary','AIComposer',
] as const

export const DESKTOP_APPLICATION_TOKENS = [
  'color.accent','color.success','color.warning','color.danger',
  'surface.canvas','surface.default','surface.raised','surface.subtle',
  'text.primary','text.secondary','text.muted','text.inverse',
  'border.default','border.strong',
  'radius.sm','radius.md','radius.lg',
  'space.xs','space.sm','space.md','space.lg','space.xl',
  'density.compact','density.default','density.comfortable',
  'type.body','type.label','type.title','type.metric',
  'motion.fast','motion.standard','motion.slow',
  'elevation.none','elevation.low','elevation.medium',
] as const

export const DESKTOP_APPLICATION_PATTERNS = [
  'List','Master Detail','Dashboard','Object Detail','Approval Queue','Wizard','Search','Settings',
  'Operations Console','Task Workspace','Analytics',
] as const

const components = new Set<string>(DESKTOP_APPLICATION_COMPONENTS)
const tokens = new Set<string>(DESKTOP_APPLICATION_TOKENS)
const patterns = new Set<string>(DESKTOP_APPLICATION_PATTERNS)

export interface DesktopApplicationContractIssue {
  code: 'DESIGN_SYSTEM_UNSUPPORTED' | 'COMPONENT_UNKNOWN' | 'TOKEN_UNKNOWN' | 'PATTERN_UNKNOWN'
  path: string
  message: string
}

export function validateDesktopApplicationContract(
  page: DesktopApplicationPageSchema,
  designSystem: { id: string; version: string },
): DesktopApplicationContractIssue[] {
  const issues: DesktopApplicationContractIssue[] = []
  if (
    designSystem.id !== OBIS_ENTERPRISE_DESIGN_SYSTEM.id
    || designSystem.version !== OBIS_ENTERPRISE_DESIGN_SYSTEM.version
  ) {
    issues.push({
      code: 'DESIGN_SYSTEM_UNSUPPORTED',
      path: 'designSystem',
      message: `Unsupported design system ${designSystem.id}@${designSystem.version}.`,
    })
  }
  if (page.pattern && !patterns.has(page.pattern)) {
    issues.push({
      code: 'PATTERN_UNKNOWN',
      path: 'page.pattern',
      message: `Unknown application pattern ${page.pattern}.`,
    })
  }

  const visit = (node: DesktopApplicationUiNode, path: string): void => {
    if (!components.has(node.component)) {
      issues.push({
        code: 'COMPONENT_UNKNOWN',
        path,
        message: `Unknown application component ${node.component}.`,
      })
    }
    for (const token of node.tokenRefs ?? []) {
      if (!tokens.has(token)) {
        issues.push({
          code: 'TOKEN_UNKNOWN',
          path: `${path}.tokenRefs`,
          message: `Unknown application design token ${token}.`,
        })
      }
    }
    for (const [index, child] of (node.children ?? []).entries()) {
      visit(child, `${path}.children[${index}]`)
    }
  }
  visit(page.layout, 'page.layout')
  return issues
}
