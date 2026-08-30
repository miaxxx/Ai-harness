/**
 * Stage the symlink-free ACP Runtime and a pinned official Node executable for
 * the host architecture. electron-builder copies this directory outside asar.
 */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const staging = resolve(root, 'apps/desktop/runtime-dist')
const deployed = join(staging, 'app')
const deployRootPackage = 'dsh-jsonrpc-agent-pkg'
const nodeVersion = 'v24.18.1'
const nodeHashes = {
  arm64: 'eb02f7fab96d3d67de40c5ec8566096fcb4c2026728787683ae5a97eb612b941',
  x64: '6fb20fceacbb157c2f95825b80df4a454a0f6d81cdcd7bb81eeae9147e0e76ec',
} as const

function pnpmCommand(args: string[]): { command: string; args: string[] } {
  const launcher = process.env.npm_execpath
  return launcher === undefined
    ? { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args }
    : { command: process.execPath, args: [launcher, ...args] }
}

async function run(label: string, command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
    child.once('error', (error) => {
      reject(new Error(`build-desktop-runtime: ${label} failed to spawn: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`build-desktop-runtime: ${label} failed (${code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`})`))
    })
  })
}

async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializeLinks(): Promise<void> {
  const nodeModules = join(deployed, 'node_modules')
  let link = await findSymlink(nodeModules)
  while (link !== undefined) {
    const segments = link.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
    } else {
      const source = await realpath(link)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(link, { recursive: true, force: true })
      await cp(source, link, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
    }
    link = await findSymlink(nodeModules)
  }
}

async function restoreLegacyHoists(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(deployed, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sourceNodeModules = resolve(root, 'python/sdk-runtime/node_modules')
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(deployed, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`build-desktop-runtime: deployed dependency ${dependency} is missing from ${destination} and ${source}`)
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function stageNode(): Promise<void> {
  if (process.platform !== 'darwin' || (process.arch !== 'arm64' && process.arch !== 'x64')) {
    throw new Error(`build-desktop-runtime: macOS arm64/x64 host required, got ${process.platform}-${process.arch}`)
  }
  const arch = process.arch
  const archiveName = `node-${nodeVersion}-darwin-${arch}.tar.gz`
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-desktop-node-'))
  try {
    const archive = join(temporary, archiveName)
    const response = await fetch(`https://nodejs.org/dist/${nodeVersion}/${archiveName}`)
    if (!response.ok) throw new Error(`build-desktop-runtime: Node download failed with HTTP ${response.status}`)
    await writeFile(archive, new Uint8Array(await response.arrayBuffer()))
    const actualHash = await sha256(archive)
    if (actualHash !== nodeHashes[arch]) {
      throw new Error(`build-desktop-runtime: ${archiveName} SHA-256 mismatch: ${actualHash}`)
    }
    await run('extract Node', 'tar', ['-xzf', archive, '-C', temporary])
    const destination = join(staging, 'node', 'bin', 'node')
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(join(temporary, `node-${nodeVersion}-darwin-${arch}`, 'bin', 'node'), destination)
    await chmod(destination, 0o755)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (staging === root || root.startsWith(staging + sep)) {
    throw new Error(`build-desktop-runtime: unsafe staging directory ${staging}`)
  }
  await rm(staging, { recursive: true, force: true })
  const verify = pnpmCommand(['run', 'verify-runtime-closure'])
  await run('verify Runtime closure', verify.command, verify.args)
  const deploy = pnpmCommand([
    '--filter', deployRootPackage, 'deploy', '--prod', '--ignore-scripts',
    '--config.inject-workspace-packages=true',
    '--config.node-linker=hoisted',
    '--config.link-workspace-packages=true', deployed,
  ])
  await run('deploy Runtime closure', deploy.command, deploy.args)
  await restoreLegacyHoists()
  await materializeLinks()
  await copyFile(resolve(root, 'examples/acp-agent/cordis.yml'), join(deployed, 'cordis.yml'))
  await cp(resolve(root, 'apps/cli/config/skills'), join(deployed, 'skills'), { recursive: true })
  await stageNode()
  const entry = join(deployed, 'node_modules/@deepseek-ai/dsh-acp-demo/lib/bin.js')
  if (!existsSync(entry)) throw new Error(`build-desktop-runtime: ACP entry missing at ${entry}`)
  const manifest = JSON.parse(await readFile(join(deployed, 'package.json'), 'utf8')) as Record<string, unknown>
  await writeFile(join(staging, 'manifest.json'), `${JSON.stringify({ nodeVersion, arch: process.arch, runtime: manifest.name }, null, 2)}\n`)
  console.log(`build-desktop-runtime: staged ${staging}`)
}

await main()
