/** macOS Provider using Accessibility through fixed JXA operations. @module @deepseek-ai/dsh-computer-macos */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer'
import { computerError } from '@deepseek-ai/dsh-computer'
import type { ComputerAction, ComputerElement, ComputerObservation, ComputerObservationMode, ComputerProvider, ComputerTarget } from '@deepseek-ai/dsh-computer'

export const name = 'computer-macos'
export const inject = ['computer']

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`)
  return value
}
const limits = {
  maxDepth: boundedInt('DSH_COMPUTER_AX_MAX_DEPTH', 6, 1, 12),
  maxNodes: boundedInt('DSH_COMPUTER_AX_MAX_NODES', 240, 1, 2000),
  maxTextLength: boundedInt('DSH_COMPUTER_AX_MAX_TEXT', 16000, 256, 100000),
  settleMs: boundedInt('DSH_COMPUTER_SETTLE_MS', 120, 0, 2000),
}

function run(file: string, args: readonly string[], options: { signal?: AbortSignal; maxBuffer?: number } = {}): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error !== null) reject(new Error(error.message, { cause: error }))
      else resolve({ stdout })
    })
  })
}
function stable(error: unknown): never {
  if (error instanceof Error && error.name === 'AbortError') throw error
  const message = error instanceof Error ? error.message : String(error)
  if (/not authorized|assistive access|accessibility|1002|-1743/i.test(message)) throw computerError('COMPUTER_PERMISSION_REQUIRED', message, error)
  if (/no controllable window|window unavailable/i.test(message)) throw computerError('WINDOW_UNAVAILABLE', message, error)
  if (/element expired|invalid element/i.test(message)) throw computerError('ELEMENT_EXPIRED', message, error)
  if (/action unsupported/i.test(message)) throw computerError('ACTION_UNSUPPORTED', message, error)
  if (/not found|isn't running|does not exist/i.test(message)) throw computerError('TARGET_NOT_FOUND', message, error)
  throw error
}
async function settle(signal?: AbortSignal): Promise<void> {
  if (limits.settleMs === 0) return
  await new Promise<void>((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, limits.settleMs)
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason instanceof Error ? signal.reason : new Error('Computer action cancelled.')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

interface JxaElement { id: string; role: string; label: string; value?: string; enabled: boolean; focused: boolean; bounds?: { x: number; y: number; width: number; height: number }; actions: string[] }
interface JxaSnapshot { name: string; title?: string; text: string; elements: JxaElement[]; partial: boolean }
interface JxaApp { id: string; name: string }
function jxa<T>(script: string, signal?: AbortSignal): Promise<T> {
  return run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { ...(signal === undefined ? {} : { signal }), maxBuffer: 1024 * 1024 })
    .then(({ stdout }) => JSON.parse(stdout) as T).catch(stable)
}
const appsScript = [
  "const e=Application('System Events'); ",
  "JSON.stringify(e.applicationProcesses.whose({backgroundOnly:false})().filter(p=>p.visible()).map(p=>({id:p.name(),name:p.name()})))",
].join('')
function traversal(app: string, observationId: string): string {
  return `const p=Application('System Events').applicationProcesses.byName(${JSON.stringify(app)}); if(!p.exists())throw new Error('Target not found'); const w=p.windows()[0]; if(!w)throw new Error('Window unavailable'); const maxDepth=${limits.maxDepth},maxNodes=${limits.maxNodes},maxText=${limits.maxTextLength}; const nodes=[]; let partial=false; const safe=(f,d)=>{try{return f()}catch{return d}}; const clean=v=>String(v??'').slice(0,512); function visit(x,d){if(nodes.length>=maxNodes){partial=true;return} nodes.push(x); if(d>=maxDepth)return; const children=safe(()=>x.UIElements(),[]); for(const c of children){if(nodes.length>=maxNodes){partial=true;break} visit(c,d+1)}} visit(w,0); const elements=nodes.map((x,i)=>{const pos=safe(()=>x.position(),null),size=safe(()=>x.size(),null); return {id:${JSON.stringify(observationId)}+':'+i,role:clean(safe(()=>x.role(),'')),label:clean(safe(()=>x.name()||x.description(),'')),value:clean(safe(()=>x.value(),'')),enabled:Boolean(safe(()=>x.enabled(),true)),focused:Boolean(safe(()=>x.focused(),false)),bounds:pos&&size?{x:Number(pos[0]),y:Number(pos[1]),width:Number(size[0]),height:Number(size[1])}:undefined,actions:safe(()=>x.actions().map(a=>clean(a.name())),[])}}); const text=elements.map(x=>[x.label,x.value].filter(Boolean).join(': ')).filter(Boolean).join('\\n').slice(0,maxText); JSON.stringify({name:p.name(),title:safe(()=>w.name(),undefined),text,elements,partial})`
}
function appTarget(app: string): ComputerTarget { return { kind: 'app', id: app, name: app } }
function elementIndex(elementId: string): number {
  const match = /(?:^|:)(\d+)$/.exec(elementId)
  if (match === null) throw computerError('ELEMENT_EXPIRED', 'Element id must come from the latest observation.')
  return Number(match[1])
}
function modifierNames(modifiers: readonly string[]): string {
  const names = modifiers.map(value => value === 'meta' ? 'command down' : value === 'alt' ? 'option down' : `${value} down`)
  return JSON.stringify(names)
}
function coreGraphics(): string {
  return `ObjC.import('Cocoa'); const nil=$(); const post=(type,x,y,button)=>{const e=$.CGEventCreateMouseEvent(nil,type,{x,y},button); $.CGEventPost($.kCGHIDEventTap,e); $.CFRelease(e)}; const mouseClick=(x,y,right,count)=>{const down=right?$.kCGEventRightMouseDown:$.kCGEventLeftMouseDown,up=right?$.kCGEventRightMouseUp:$.kCGEventLeftMouseUp,button=right?$.kCGMouseButtonRight:$.kCGMouseButtonLeft; for(let i=0;i<count;i++){post(down,x,y,button);post(up,x,y,button)}}; `
}
function actionScript(app: string | undefined, action: ComputerAction): string {
  const process = app === undefined ? "const p=Application('System Events').applicationProcesses.whose({frontmost:true})()[0]; if(!p)throw new Error('Target not found'); " : `const p=Application('System Events').applicationProcesses.byName(${JSON.stringify(app)}); if(!p.exists())throw new Error('Target not found'); p.frontmost=true; `
  const nodes = `const w=p.windows()[0]; if(!w)throw new Error('Window unavailable'); const nodes=[]; function visit(x,d){if(nodes.length>=${limits.maxNodes})return; nodes.push(x); if(d>=${limits.maxDepth})return; let children=[];try{children=x.UIElements()}catch{}; for(const c of children)visit(c,d+1)} visit(w,0); `
  if (action.kind === 'click') {
    if (action.point !== undefined) return process + coreGraphics() + `mouseClick(${action.point.x},${action.point.y},${action.button === 'right'},${action.count}); JSON.stringify({ok:true})`
    const index = elementIndex(action.elementId ?? '')
    if (action.button === 'right') return process + nodes + `const x=nodes[${index}];if(!x)throw new Error('Element expired'); const a=x.actions.byName('AXShowMenu');if(!a.exists())throw new Error('Action unsupported');a.perform();JSON.stringify({ok:true})`
    return process + nodes + `const x=nodes[${index}];if(!x)throw new Error('Element expired');for(let i=0;i<${action.count};i++)x.click();JSON.stringify({ok:true})`
  }
  if (action.kind === 'drag') return process + coreGraphics() + `post($.kCGEventLeftMouseDown,${action.from.x},${action.from.y},$.kCGMouseButtonLeft);post($.kCGEventLeftMouseDragged,${action.to.x},${action.to.y},$.kCGMouseButtonLeft);post($.kCGEventLeftMouseUp,${action.to.x},${action.to.y},$.kCGMouseButtonLeft);JSON.stringify({ok:true})`
  if (action.kind === 'key') return process + `const keys={Return:36,Escape:53,Tab:48,Space:49,Up:126,Down:125,Left:123,Right:124,Delete:51,Backspace:51};const code=keys[${JSON.stringify(action.key)}];if(code===undefined)Application('System Events').keystroke(${JSON.stringify(action.key)},{using:${modifierNames(action.modifiers)}});else Application('System Events').keyCode(code,{using:${modifierNames(action.modifiers)}});JSON.stringify({ok:true})`
  if (action.kind === 'scroll' && action.elementId === undefined) {
    const dx = action.direction === 'left' ? -action.amount : action.direction === 'right' ? action.amount : 0
    const dy = action.direction === 'up' ? action.amount : action.direction === 'down' ? -action.amount : 0
    return process + `ObjC.import('Cocoa');const e=$.CGEventCreateScrollWheelEvent($(),$.kCGScrollEventUnitPixel,2,${dy},${dx});$.CGEventPost($.kCGHIDEventTap,e);$.CFRelease(e);JSON.stringify({ok:true})`
  }
  const index = elementIndex('elementId' in action && action.elementId !== undefined ? action.elementId : '')
  if (action.kind === 'set_value') return process + nodes + `const x=nodes[${index}];if(!x)throw new Error('Element expired');x.value=${JSON.stringify(action.value)};JSON.stringify({ok:true})`
  if (action.kind === 'type_text') return process + nodes + `const x=nodes[${index}];if(!x)throw new Error('Element expired');x.focused=true;Application('System Events').keystroke(${JSON.stringify(action.text)});JSON.stringify({ok:true})`
  if (action.kind === 'paste') return process + nodes + `const x=nodes[${index}];if(!x)throw new Error('Element expired');x.focused=true;const host=Application.currentApplication();host.includeStandardAdditions=true;const old=host.theClipboard();try{host.setTheClipboardTo(${JSON.stringify(action.text)});Application('System Events').keystroke('v',{using:'command down'})}finally{host.setTheClipboardTo(old)};JSON.stringify({ok:true})`
  if (action.kind === 'scroll') return process + nodes + `const x=nodes[${index}];if(!x)throw new Error('Element expired');const a=x.actions.byName(${JSON.stringify(`AXScroll${action.direction[0]!.toUpperCase()}${action.direction.slice(1)}`)});if(!a.exists())throw new Error('Action unsupported');for(let i=0;i<Math.max(1,Math.round(${action.amount}/100));i++)a.perform();JSON.stringify({ok:true})`
  if (action.kind === 'secondary_action') return process + nodes + `const x=nodes[${index}];if(!x)throw new Error('Element expired');const a=x.actions.byName('AXShowMenu');if(!a.exists())throw new Error('Action unsupported');a.perform();JSON.stringify({ok:true})`
  throw computerError('ACTION_UNSUPPORTED', `Unsupported macOS action ${(action as { kind: string }).kind}.`)
}
async function screenshotDesktop(signal?: AbortSignal): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-computer-'))
  const path = join(directory, 'desktop.png')
  try {
    await run('/usr/sbin/screencapture', ['-x', '-t', 'png', path], signal === undefined ? {} : { signal }).catch(error => { throw computerError('CAPTURE_FAILED', 'Desktop capture failed.', error) })
    return new Uint8Array(await readFile(path))
  } finally { await rm(directory, { recursive: true, force: true }) }
}
async function observe(target: ComputerTarget, mode: ComputerObservationMode, signal?: AbortSignal): Promise<ComputerObservation> {
  signal?.throwIfAborted()
  const id = randomUUID()
  if (target.kind === 'browser-tab') throw computerError('ACTION_UNSUPPORTED', 'The macOS provider does not support browser-tab targets.')
  if (target.kind === 'desktop') {
    const visual = mode === 'accessibility' ? undefined : { image: { data: await screenshotDesktop(signal), mediaType: 'image/png' as const, name: 'desktop.png' }, scope: 'desktop' as const }
    return { id, target, accessibility: mode === 'visual' ? undefined : { text: '', elements: [] }, ...(visual === undefined ? {} : { visual }) }
  }
  if (mode !== 'accessibility') throw computerError('WINDOW_UNAVAILABLE', 'Window-scoped macOS capture is unavailable; refusing to mislabel a full-screen capture as an app window.')
  const value = await jxa<JxaSnapshot>(traversal(target.id, id), signal)
  const elements: ComputerElement[] = value.elements.map(element => ({ ...element }))
  return { id, target: appTarget(value.name), ...(value.title === undefined ? {} : { title: value.title }), accessibility: { text: value.text, elements, ...(value.partial ? { partial: true } : {}) } }
}

/** Register target-aware macOS control. */
export function apply(ctx: Context): void {
  const provider: ComputerProvider = {
    id: 'macos-accessibility', targetKinds: ['app', 'desktop'], available: () => process.platform === 'darwin',
    async listTargets(signal) {
      const apps = await jxa<JxaApp[]>(appsScript, signal)
      return [{ kind: 'desktop', id: 'desktop', name: 'Desktop' } as const, ...apps.map(app => ({ kind: 'app' as const, id: app.id, name: app.name }))]
    },
    observe,
    async perform(target, action, signal) {
      if (target.kind === 'browser-tab') throw computerError('ACTION_UNSUPPORTED', 'The macOS provider does not support browser-tab targets.')
      await jxa<{ ok: true }>(actionScript(target.kind === 'app' ? target.id : undefined, action), signal)
      await settle(signal)
      return observe(target, 'accessibility', signal)
    },
  }
  ctx.computer.register(provider)
}
