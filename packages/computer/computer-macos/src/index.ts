/** macOS Provider using the system Accessibility API through a fixed JXA bridge. @module @deepseek-ai/dsh-computer-macos */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer'
import type { ComputerAction, ComputerApp, ComputerElement, ComputerProvider, ComputerSnapshot } from '@deepseek-ai/dsh-computer'

export const name = 'computer-macos'
export const inject = ['computer']

function run(
  file: string,
  args: readonly string[],
  options: { signal?: AbortSignal; maxBuffer?: number } = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error !== null) reject(new Error(error.message, { cause: error }))
      else resolve({ stdout })
    })
  })
}

interface JxaSnapshot {
  name: string
  title?: string
  text: string
  elements: Array<{ id: string; role: string; label: string; enabled: boolean }>
}
function jxa(script: string, signal?: AbortSignal): Promise<JxaSnapshot | ComputerApp[]> {
  return run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
    ...(signal === undefined ? {} : { signal }), maxBuffer: 512 * 1024,
  }).then(({ stdout }) => JSON.parse(stdout) as JxaSnapshot | ComputerApp[])
}
const appsScript = [
  'const e=Application(\'System Events\'); ',
  'JSON.stringify(e.applicationProcesses.whose({backgroundOnly:false})()',
  '.filter(p=>p.visible()).map(p=>({id:p.name(),name:p.name()})))',
].join('')
function snapshotExpression(): string {
  return [
    'const es=w? w.UIElements() : []; ',
    'JSON.stringify({name:p.name(),title:w?w.name():undefined,text:w?String(w.description()||\'\'): \'\',',
    'elements:es.slice(0,80).map((x,i)=>({id:String(i),role:String(x.role()),',
    'label:String(x.name()||x.description()||\'\'),enabled:Boolean(x.enabled())}))})',
  ].join('')
}
function inspectScript(app: string): string {
  return `const p=Application('System Events').applicationProcesses.byName(${JSON.stringify(app)}); const w=p.windows()[0]; ${snapshotExpression()}`
}
function actionScript(app: string, action: ComputerAction): string {
  const base = `const p=Application('System Events').applicationProcesses.byName(${JSON.stringify(app)}); const w=p.windows()[0]; if(!w)throw new Error('No controllable window'); const es=w.UIElements(); `
  if (action.kind === 'click') return base + `es[${Number(action.elementId)}].click(); ` + snapshotExpression()
  if (action.kind === 'type') return base + `const x=es[${Number(action.elementId)}]; x.focused=true; Application('System Events').keystroke(${JSON.stringify(action.text)}); ` + snapshotExpression()
  if (action.kind === 'key') return base + `const keys={Return:36,Escape:53,Tab:48,Space:49,Up:126,Down:125,Left:123,Right:124}; const code=keys[${JSON.stringify(action.key)}]; if(code===undefined) throw new Error('Unsupported key'); Application('System Events').keyCode(code); ` + snapshotExpression()
  return base + `const x=es[${Number(action.elementId)}]; x.actions.byName(${JSON.stringify(action.direction === 'up' ? 'AXScrollUp' : 'AXScrollDown')}).perform(); ` + snapshotExpression()
}
async function screenshot(): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-computer-'))
  const path = join(directory, 'snapshot.png')
  try { await run('/usr/sbin/screencapture', ['-x', '-t', 'png', path]); return new Uint8Array(await readFile(path)) }
  finally { await rm(directory, { recursive: true, force: true }) }
}
function snapshot(value: JxaSnapshot, image?: Uint8Array): ComputerSnapshot {
  const elements: ComputerElement[] = value.elements.map(element => ({ ...element }))
  return { app: { id: value.name, name: value.name }, ...(value.title === undefined ? {} : { title: value.title }), text: value.text, elements, ...(image === undefined ? {} : { screenshot: { data: image, mediaType: 'image/png', name: `${value.name}-snapshot.png` } }) }
}
/** Register the macOS-only Provider. macOS grants Accessibility and Screen Recording permissions to the runtime process. */
export function apply(ctx: Context): void {
  const provider: ComputerProvider = {
    id: 'macos-accessibility', available: () => process.platform === 'darwin',
    async listApps(signal) { return await jxa(appsScript, signal) as ComputerApp[] },
    async inspect(app, includeScreenshot, signal) {
      const value = await jxa(inspectScript(app), signal) as JxaSnapshot
      return snapshot(value, includeScreenshot ? await screenshot() : undefined)
    },
    async act(app, action, signal) { return snapshot(await jxa(actionScript(app, action), signal) as JxaSnapshot) },
  }
  ctx.computer.register(provider)
}
