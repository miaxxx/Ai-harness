/** Model-facing target-aware computer tool. @module @deepseek-ai/dsh-tool-computer */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-computer'
import { computerError } from '@deepseek-ai/dsh-computer'
import type { ComputerAction, ComputerObservation, ComputerTarget, ComputerTargetKind } from '@deepseek-ai/dsh-computer'
import type {} from '@deepseek-ai/dsh-user-approval'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export const name = 'tool-computer'
export const inject = ['tools', 'computer', 'attachments']

type ActionName = 'list' | 'observe' | 'click' | 'drag' | 'set_value' | 'type_text' | 'paste' | 'key' | 'scroll' | 'secondary_action'
type Args = {
  action: ActionName
  targetKind?: ComputerTargetKind
  target?: string
  observation?: 'accessibility' | 'visual' | 'both'
  elementId?: string
  x?: number; y?: number; toX?: number; toY?: number
  button?: 'left' | 'right'; double?: boolean
  text?: string; value?: string; key?: string; modifiers?: Array<'alt' | 'control' | 'meta' | 'shift'>
  direction?: 'up' | 'down' | 'left' | 'right'; amount?: number
}
function need(value: string | undefined, field: string): string { if (value === undefined || value.trim() === '') throw new Error(`computer: ${field} is required for this action`); return value }
function number(value: number | undefined, field: string): number { if (value === undefined || !Number.isFinite(value)) throw new Error(`computer: ${field} is required for this action`); return value }
function target(args: Args): ComputerTarget {
  const kind = args.targetKind ?? 'app'
  if (kind === 'desktop') return { kind, id: 'desktop', name: 'Desktop' }
  const id = need(args.target, 'target')
  return kind === 'browser-tab' ? { kind, id, name: id } : { kind, id, name: id }
}
function targetKey(value: ComputerTarget): string { return `${value.kind}:${value.id}` }
function scopedElement(value: string | undefined, observation: ComputerObservation | undefined): string {
  const id = need(value, 'elementId')
  if (observation === undefined || !id.startsWith(`${observation.id}:`)) throw computerError('ELEMENT_EXPIRED', 'elementId must come from the latest observation for this target.')
  return id
}
function semanticIdentity(element: NonNullable<ComputerObservation['accessibility']>['elements'][number]): string {
  const b = element.bounds
  return `${element.role}|${element.label}|${b === undefined ? '' : `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`}`
}
function semanticDiff(previous: ComputerObservation | undefined, next: ComputerObservation): string | undefined {
  if (previous?.accessibility === undefined || next.accessibility === undefined) return undefined
  const before = new Map(previous.accessibility.elements.map(element => [semanticIdentity(element), element]))
  const after = new Map(next.accessibility.elements.map(element => [semanticIdentity(element), element]))
  const lines: string[] = []
  for (const [identity, element] of after) {
    const old = before.get(identity)
    if (old === undefined) lines.push(`+ ${element.role}: ${element.label}`)
    else if (old.value !== element.value || old.enabled !== element.enabled || old.focused !== element.focused) lines.push(`~ ${element.role}: ${element.label}${element.value ? ` = ${element.value}` : ''}`)
  }
  for (const [identity, element] of before) if (!after.has(identity)) lines.push(`- ${element.role}: ${element.label}`)
  return lines.length === 0 ? 'No semantic change detected.' : lines.slice(0, 80).join('\n')
}
interface RenderValue {
  targets?: Array<ComputerTarget>
  target?: ComputerTarget
  title?: string
  accessibility?: ComputerObservation['accessibility']
  visual?: { scope: string; image: unknown }
  diff?: string
}
function render(value: RenderValue): ContentBlock[] {
  if (value.targets !== undefined) return [{ type: 'text', text: value.targets.map(item => `- ${item.kind}: ${item.name} (${item.id})`).join('\n') || 'No controllable targets are visible.' }]
  const lines = [
    `Target: ${value.target?.kind ?? 'unknown'} ${value.target?.name ?? ''}`.trim(),
    ...(value.title === undefined ? [] : [`Window: ${value.title}`]),
    ...(value.diff === undefined ? [value.accessibility?.text ?? '', ...(value.accessibility?.elements ?? []).map(element => `[${element.id}] ${element.role}: ${element.label}${element.value ? ` = ${element.value}` : ''}${element.enabled ? '' : ' (disabled)'}${element.focused ? ' (focused)' : ''}`)] : [`Changes since previous observation:\n${value.diff}`]),
    ...(value.accessibility?.partial ? ['Observation truncated by configured accessibility bounds.'] : []),
  ]
  const blocks: ContentBlock[] = [{ type: 'text', text: lines.filter(Boolean).join('\n') }]
  if (value.visual !== undefined && typeof value.visual.image === 'object' && value.visual.image !== null) blocks.push({ type: 'image', attachment: value.visual.image as never })
  return blocks
}
function actionFrom(args: Args, current: ComputerObservation | undefined): ComputerAction {
  if (args.action === 'click') {
    const elementId = args.elementId === undefined ? undefined : scopedElement(args.elementId, current)
    const point = elementId === undefined ? { x: number(args.x, 'x'), y: number(args.y, 'y') } : undefined
    return { kind: 'click', ...(elementId === undefined ? {} : { elementId }), ...(point === undefined ? {} : { point }), button: args.button ?? 'left', count: args.double === true ? 2 : 1 }
  }
  if (args.action === 'drag') return { kind: 'drag', from: { x: number(args.x, 'x'), y: number(args.y, 'y') }, to: { x: number(args.toX, 'toX'), y: number(args.toY, 'toY') } }
  if (args.action === 'set_value') return { kind: 'set_value', elementId: scopedElement(args.elementId, current), value: need(args.value, 'value') }
  if (args.action === 'type_text') return { kind: 'type_text', elementId: scopedElement(args.elementId, current), text: need(args.text, 'text') }
  if (args.action === 'paste') return { kind: 'paste', elementId: scopedElement(args.elementId, current), text: need(args.text, 'text') }
  if (args.action === 'key') return { kind: 'key', key: need(args.key, 'key'), modifiers: args.modifiers ?? [] }
  if (args.action === 'scroll') {
    const elementId = args.elementId === undefined ? undefined : scopedElement(args.elementId, current)
    const point = elementId === undefined && args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : undefined
    return { kind: 'scroll', ...(elementId === undefined ? {} : { elementId }), ...(point === undefined ? {} : { point }), direction: args.direction ?? 'down', amount: Math.max(1, Math.min(args.amount ?? 600, 4000)) }
  }
  if (args.action === 'secondary_action') return { kind: 'secondary_action', elementId: scopedElement(args.elementId, current) }
  throw computerError('ACTION_UNSUPPORTED', `Unsupported action ${args.action}.`)
}

/** Register the single computer tool. Runtime state is limited to latest semantic observations per agent and target. */
export function apply(ctx: Context): void {
  const observations = new Map<string, Map<string, ComputerObservation>>()
  const latest = (agentId: string | undefined, value: ComputerTarget): ComputerObservation | undefined => agentId === undefined ? undefined : observations.get(agentId)?.get(targetKey(value))
  const remember = (agentId: string | undefined, value: ComputerObservation): void => {
    if (agentId === undefined) return
    let agent = observations.get(agentId)
    if (agent === undefined) { agent = new Map(); observations.set(agentId, agent) }
    agent.set(targetKey(value.target), value)
  }
  const persisted = async (value: ComputerObservation): Promise<RenderValue & { id: string }> => {
    if (value.visual === undefined) return value as unknown as RenderValue & { id: string }
    const image = await ctx.attachments.saveImage(value.visual.image)
    return { ...value, visual: { scope: value.visual.scope, image } } as unknown as RenderValue & { id: string }
  }

  ctx.tools.register(defineTool({
    name: 'computer',
    description: 'Observe or operate desktop, native-app, and browser-tab targets. Prefer purpose-built APIs/CLI first. Observe the named target directly; list only for discovery. Prefer accessibility state and element actions, using visual/coordinates only when semantic state is insufficient. Every mutation returns fresh state; never reuse an element id after an action.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'observe', 'click', 'drag', 'set_value', 'type_text', 'paste', 'key', 'scroll', 'secondary_action'] },
      targetKind: { type: 'string', enum: ['app', 'browser-tab', 'desktop'], description: 'Target kind; defaults to app.' },
      target: { type: 'string', description: 'Native app name/id or browser tab id. Omit for desktop.' },
      observation: { type: 'string', enum: ['accessibility', 'visual', 'both'], description: 'Observation mode; accessibility is the default.' },
      elementId: { type: 'string', description: 'Element id from the latest observation for this agent and target.' },
      x: { type: 'number' }, y: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' },
      button: { type: 'string', enum: ['left', 'right'] }, double: { type: 'boolean' },
      text: { type: 'string' }, value: { type: 'string' }, key: { type: 'string' }, modifiers: { type: 'array', items: { type: 'string', enum: ['alt', 'control', 'meta', 'shift'] } },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: (_args, value) => render(value as never) },
    async execute(args: Args, exec) {
      if (args.action === 'list') return { targets: await ctx.computer.listTargets(args.targetKind, exec.signal) } as unknown as Record<string, never>
      const selected = target(args)
      const agentId = exec.agent?.id as string | undefined
      if (args.action === 'observe') {
        const mode = args.observation ?? 'accessibility'
        if (mode !== 'accessibility') {
          const approval = ctx.get('approval')
          if (exec.agent === undefined || approval === undefined) throw new Error('computer: visual observation requires an active approval provider')
          const outcome = await approval.request({ agent: exec.agent, toolName: 'computer', callId: exec.callId, reason: `Allow a visual observation of ${selected.name}.`, signal: exec.signal })
          if (outcome !== 'allowed-once') throw new Error(`computer: visual observation of ${selected.name} was not approved`)
        }
        const value = await ctx.computer.observe(selected, mode, exec.signal)
        remember(agentId, value)
        return await persisted(value) as unknown as Record<string, never>
      }
      if (exec.agent === undefined) throw new Error('computer: an active session is required for a mutating action')
      const approval = ctx.get('approval')
      if (approval === undefined) throw new Error('computer: mutating actions require an approval provider')
      const previous = latest(agentId, selected)
      const action = actionFrom(args, previous)
      const outcome = await approval.request({ agent: exec.agent, toolName: 'computer', callId: exec.callId, reason: `Allow ${args.action} in ${selected.name}.`, signal: exec.signal })
      if (outcome !== 'allowed-once') throw new Error(`computer: ${args.action} in ${selected.name} was not approved`)
      const next = await ctx.computer.perform(selected, action, exec.signal)
      const diff = semanticDiff(previous, next)
      remember(agentId, next)
      return { ...(await persisted(next)), ...(diff === undefined ? {} : { diff }) } as unknown as Record<string, never>
    },
    presentCall: args => ({ card: 'generic', title: `Computer: ${args.action}`, kind: 'execute', rawInput: JSON.stringify(args) }),
  }))
}
