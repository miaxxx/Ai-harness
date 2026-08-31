/** Relocate and launch the packaged macOS application without repository or Node lookup. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const architecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
if (process.platform !== 'darwin' || architecture === undefined) {
  throw new Error(`verify-desktop-dist: macOS arm64/x64 host required, got ${process.platform}-${process.arch}`)
}
const source = resolve(process.argv[2] ?? join(
  root,
  'apps/desktop/dist-electron',
  `mac-${architecture}`,
  'Orbis AI.app',
))
if (!existsSync(source)) throw new Error(`verify-desktop-dist: application missing at ${source}`)

async function run(command: string, args: string[], cwd: string, env = process.env, timeoutMs?: number): Promise<{ stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let timedOut = false
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (timer !== undefined) clearTimeout(timer)
      if (timedOut) reject(new Error(`verify-desktop-dist: ${basename(command)} timed out after ${timeoutMs} ms:\n${stderr}`))
      else if (code === 0) resolvePromise({ stderr })
      else reject(new Error(`verify-desktop-dist: ${basename(command)} failed (${code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`}):\n${stderr}`))
    })
  })
}

const temporary = await mkdtemp(join(tmpdir(), 'dsh-desktop-dist-'))
try {
  const relocated = join(temporary, 'Orbis AI.app')
  await run('ditto', [source, relocated], temporary)
  const runtime = join(relocated, 'Contents', 'Resources', 'runtime', 'app')
  const config = await readFile(join(runtime, 'cordis.yml'), 'utf8')
  if (!config.includes("name: '@deepseek-ai/dsh-compaction-tool-result-pruner'")) {
    throw new Error('verify-desktop-dist: embedded ACP Runtime omits oversized tool-result recovery')
  }
  for (const expected of [
    'maxImagePixels: 201326592',
    'maxImageDimension: 32768',
    'imageCompressionConcurrency: 1',
  ]) {
    if (!config.includes(expected)) {
      throw new Error(`verify-desktop-dist: embedded ACP Runtime omits large-canvas image policy ${expected}`)
    }
  }
  const prunerEntry = join(
    runtime,
    'node_modules',
    '@deepseek-ai',
    'dsh-compaction-tool-result-pruner',
    'lib',
    'index.js',
  )
  if (!existsSync(prunerEntry)) {
    throw new Error(`verify-desktop-dist: embedded tool-result pruner missing at ${prunerEntry}`)
  }
  const workspace = join(temporary, 'workspace')
  await run('mkdir', ['-p', workspace], temporary)
  const executable = join(relocated, 'Contents', 'MacOS', 'Orbis AI')
  const environment: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TMPDIR: temporary,
    DEEPSEEK_API_KEY: 'keyless-desktop-dist-smoke',
    DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
    DSH_HOME: join(temporary, '.dsh'),
    DSH_AGENTS_HOME: join(temporary, '.agents'),
    DSH_DESKTOP_WORKSPACE: workspace,
    DSH_DESKTOP_DIST_SMOKE: '1',
  }
  const result = await run(
    executable,
    [`--user-data-dir=${join(temporary, 'user-data')}`],
    temporary,
    environment,
    60_000,
  )
  if (!result.stderr.includes('desktop-dist-smoke: ready')) {
    throw new Error(`verify-desktop-dist: application exited without the ready marker:\n${result.stderr}`)
  }
  console.log(`verify-desktop-dist: relocated ${basename(source)} initialized its embedded ACP Runtime without external Node or repository paths.`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
