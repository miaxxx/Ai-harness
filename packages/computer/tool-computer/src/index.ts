/**
 * Model-facing local computer tool. Inspection is read-only; every app action
 * requires the existing approval service.
 * @module @deepseek-ai/dsh-tool-computer
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-computer'
import type {} from '@deepseek-ai/dsh-user-approval'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export const name = 'tool-computer'
export const inject = ['tools', 'computer', 'attachments']

type Args = { action: 'list' | 'inspect' | 'click' | 'type' | 'key' | 'scroll'; app?: string; elementId?: string; text?: string; key?: string; direction?: 'up' | 'down'; screenshot?: boolean }
function need(value: string | undefined, field: string): string { if (value === undefined || value.trim() === '') throw new Error(`computer: ${field} is required for this action`); return value }
function elementId(value: string | undefined): string {
  const id = need(value, 'elementId')
  if (!/^\d+$/.test(id)) throw new Error('computer: elementId must come from the latest inspect result')
  return id
}
interface RenderValue {
  app?: { name: string }
  title?: string
  text?: string
  elements?: Array<{ id: string; role: string; label: string; enabled: boolean }>
  apps?: Array<{ id: string; name: string }>
  screenshot?: unknown
}
function render(value: RenderValue): ContentBlock[] {
  if (value.apps !== undefined) return [{ type: 'text', text: value.apps.map(app => `- ${app.name} (${app.id})`).join('\n') || 'No controllable applications are visible.' }]
  const lines = [`App: ${value.app?.name ?? 'unknown'}`, ...(value.title === undefined ? [] : [`Window: ${value.title}`]), value.text ?? '', ...(value.elements ?? []).map(element => `[${element.id}] ${element.role}: ${element.label}${element.enabled ? '' : ' (disabled)'}`)]
  const blocks: ContentBlock[] = [{ type: 'text', text: lines.filter(Boolean).join('\n') }]
  if (typeof value.screenshot === 'object' && value.screenshot !== null) blocks.push({ type: 'image', attachment: value.screenshot as never })
  return blocks
}

/** Register one tool that lists, inspects, and performs small approved actions in a selected app. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'computer',
    description: 'Inspect or operate an approved local desktop app. Use list, then pass the returned app id to inspect. Inspect before every click/type/scroll because element ids expire after each operation. Prefer app APIs, browser automation, shell, or filesystem tools when they can complete the task.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'inspect', 'click', 'type', 'key', 'scroll'] },
      app: { type: 'string', description: 'App id from computer list.' }, elementId: { type: 'string', description: 'Element id from the latest inspect result.' },
      text: { type: 'string', description: 'Text to enter for type.' }, key: { type: 'string', description: 'Named key for key, for example Return or Escape.' },
      direction: { type: 'string', enum: ['up', 'down'], description: 'Direction for scroll.' }, screenshot: { type: 'boolean', description: 'Include a screenshot on inspect when accessibility text is insufficient.' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: (_args, value) => render(value as never) },
    async execute(args: Args, exec) {
      if (args.action === 'list') return { apps: await ctx.computer.listApps(exec.signal) } as unknown as Record<string, never>
      const app = need(args.app, 'app')
      if (args.action === 'inspect') {
        if (args.screenshot === true) {
          const agent = exec.agent
          const approval = ctx.get('approval')
          if (agent === undefined || approval === undefined) throw new Error('computer: screenshots require an active approval provider')
          const outcome = await approval.request({ agent, toolName: 'computer', callId: exec.callId, reason: `Allow a screenshot of ${app}.`, signal: exec.signal })
          if (outcome !== 'allowed-once') throw new Error(`computer: screenshot of ${app} was not approved`)
        }
        const snapshot = await ctx.computer.inspect(app, args.screenshot === true, exec.signal)
        const screenshot = snapshot.screenshot === undefined ? undefined : (await ctx.attachments.saveImage(snapshot.screenshot))
        return { ...snapshot, ...(screenshot === undefined ? {} : { screenshot }) } as unknown as Record<string, never>
      }
      const agent = exec.agent
      if (agent === undefined) throw new Error('computer: an active session is required for an app action')
      const approval = ctx.get('approval')
      if (approval === undefined) throw new Error('computer: app actions require an approval provider')
      const outcome = await approval.request({ agent, toolName: 'computer', callId: exec.callId, reason: `Allow ${args.action} in ${app}.`, signal: exec.signal })
      if (outcome !== 'allowed-once') throw new Error(`computer: ${args.action} in ${app} was not approved`)
      const action = args.action === 'click' ? { kind: 'click' as const, elementId: elementId(args.elementId) }
        : args.action === 'type' ? { kind: 'type' as const, elementId: elementId(args.elementId), text: need(args.text, 'text') }
          : args.action === 'key' ? { kind: 'key' as const, key: need(args.key, 'key') }
            : { kind: 'scroll' as const, elementId: elementId(args.elementId), direction: args.direction ?? 'down' }
      return await ctx.computer.act(app, action, exec.signal) as unknown as Record<string, never>
    },
    presentCall: args => ({ card: 'generic', title: `Computer: ${args.action}`, kind: 'execute', rawInput: JSON.stringify(args) }),
  }))
}
