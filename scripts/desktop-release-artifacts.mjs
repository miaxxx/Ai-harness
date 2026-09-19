import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const channels = new Set(['canary', 'beta', 'stable', 'enterprise-lts'])

function semver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value ?? '').trim())
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? '' } : undefined
}
export function releaseChannelForVersion(version) {
  const parsed = semver(version)
  if (!parsed) throw new Error(`Invalid Desktop release version: ${version}`)
  if (/enterprise[-.]?lts/i.test(parsed.prerelease)) return 'enterprise-lts'
  if (/canary/i.test(parsed.prerelease)) return 'canary'
  if (/beta|rc/i.test(parsed.prerelease)) return 'beta'
  return 'stable'
}
export function validateRelease(version, channel) {
  if (!channels.has(channel)) throw new Error(`Unsupported Desktop release channel: ${channel}`)
  const actual = releaseChannelForVersion(version)
  if (actual !== channel) throw new Error(`Desktop version ${version} belongs to ${actual}, not ${channel}`)
  return { version, channel }
}

async function walk(root, directory = root) {
  const output = []
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    const info = await stat(path)
    if (info.isDirectory()) output.push(...await walk(root, path))
    else output.push({ path, relative: relative(root, path), size: info.size })
  }
  return output
}
async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
async function ensureAlias(source, destination) {
  if (resolve(source) === resolve(destination)) return
  await copyFile(source, destination)
}

export async function verifyDesktopReleaseConfig(packagePath = join(repositoryRoot, 'apps/desktop/package.json')) {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  const failures = []
  if (!pkg.dependencies?.['electron-updater']) failures.push('electron-updater dependency is missing')
  if (pkg.build?.appId !== 'ai.orbis.desktop') failures.push('Desktop appId is not frozen')
  if (!String(pkg.build?.artifactName ?? '').includes('${arch}')) failures.push('artifactName must include ${arch}')
  const macTargets = pkg.build?.mac?.target ?? []
  const winTargets = pkg.build?.win?.target ?? []
  for (const target of ['dmg', 'zip']) if (!macTargets.includes(target)) failures.push(`mac target ${target} is missing`)
  if (!winTargets.includes('nsis')) failures.push('Windows NSIS target is missing')
  if (pkg.build?.mac?.identity === null) failures.push('mac identity is explicitly disabled; Stage B signing could not be enabled by credentials alone')
  const provider = pkg.build?.publish?.find?.(value => value.provider === 'github')
  if (!provider || provider.owner !== 'miaxxx' || provider.repo !== 'Ai-harness') failures.push('GitHub update provider is not configured')
  if (!String(pkg.scripts?.['dist:mac:release'] ?? '').includes('--x64') || !String(pkg.scripts?.['dist:mac:release'] ?? '').includes('--arm64')) failures.push('mac release script must package x64 and arm64')
  if (!String(pkg.scripts?.['dist:win:release'] ?? '').includes('--x64')) failures.push('Windows release script must explicitly package x64')
  if (failures.length) throw new Error(`Desktop release config invalid:\n- ${failures.join('\n- ')}`)
  return pkg
}

export async function finalizeDesktopArtifacts({ root, version, channel, target }) {
  validateRelease(version, channel)
  if (target !== 'mac' && target !== 'win') throw new Error(`Unsupported Desktop release target: ${target}`)
  await mkdir(root, { recursive: true })
  let files = await walk(root)
  if (target === 'mac') {
    const dmg = files.filter(file => file.relative.endsWith('.dmg'))
    const zip = files.filter(file => file.relative.endsWith('.zip'))
    if (!dmg.length || !zip.length) throw new Error('macOS release requires DMG and ZIP artifacts')
    const names = [...dmg, ...zip].map(file => basename(file.relative))
    for (const arch of ['x64', 'arm64']) if (!names.some(name => name.includes(`-${arch}.`))) throw new Error(`macOS release is missing ${arch} artifacts`)
  } else {
    const installers = files.filter(file => file.relative.endsWith('.exe'))
    if (!installers.some(file => basename(file.relative).includes('-x64.'))) throw new Error('Windows release is missing x64 NSIS artifact')
  }

  const yml = files.filter(file => /\.ya?ml$/i.test(file.relative))
  const candidates = target === 'mac'
    ? yml.filter(file => /mac/i.test(basename(file.relative)))
    : yml.filter(file => !/mac/i.test(basename(file.relative)))
  if (!candidates.length) throw new Error(`${target} release did not generate update metadata`)
  const source = candidates.find(file => basename(file.relative).startsWith('latest')) ?? candidates[0]
  const latestName = target === 'mac' ? 'latest-mac.yml' : 'latest.yml'
  const channelName = target === 'mac' ? `${channel}-mac.yml` : `${channel}.yml`
  await ensureAlias(source.path, join(root, latestName))
  await ensureAlias(source.path, join(root, channelName))

  files = await walk(root)
  const releaseFiles = files.filter(file => /\.(?:dmg|zip|exe|ya?ml|blockmap)$/i.test(file.relative))
  const manifest = {
    schemaVersion: 2,
    version,
    channel,
    target,
    generatedAt: new Date().toISOString(),
    metadataAliases: [latestName, channelName],
    files: await Promise.all(releaseFiles.map(async file => ({ file: file.relative, size: file.size, sha256: await sha256(file.path) })))
  }
  const manifestPath = join(root, `release-manifest-${target}.json`)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifest, manifestPath }
}

export async function buildDesktopReleaseIndex({ root, version, channel }) {
  validateRelease(version, channel)
  const manifests = []
  for (const target of ['mac', 'win']) {
    const matches = (await walk(root)).filter(file => basename(file.relative) === `release-manifest-${target}.json`)
    if (matches.length !== 1) throw new Error(`Expected exactly one release-manifest-${target}.json, found ${matches.length}`)
    const manifest = JSON.parse(await readFile(matches[0].path, 'utf8'))
    if (manifest.version !== version || manifest.channel !== channel || manifest.target !== target) throw new Error(`${target} release manifest does not match release metadata`)
    manifests.push({ target, path: matches[0].relative, manifest })
  }
  const files = (await walk(root)).filter(file => !file.relative.endsWith('desktop-release-index.json'))
  const index = {
    schemaVersion: 1,
    version,
    channel,
    generatedAt: new Date().toISOString(),
    targets: manifests.map(value => ({ target: value.target, manifest: value.path })),
    files: await Promise.all(files.map(async file => ({ file: file.relative, size: file.size, sha256: await sha256(file.path) })))
  }
  await writeFile(join(root, 'desktop-release-index.json'), `${JSON.stringify(index, null, 2)}\n`)
  return index
}

function args() {
  const values = process.argv.slice(3)
  const result = {}
  for (let index = 0; index < values.length; index += 2) result[values[index]?.replace(/^--/, '')] = values[index + 1]
  return result
}
async function main() {
  const command = process.argv[2]
  const input = args()
  if (command === 'validate') {
    await verifyDesktopReleaseConfig()
    validateRelease(input.version, input.channel)
    console.log(`Desktop release contract verified: ${input.version} (${input.channel}).`)
    return
  }
  if (command === 'finalize') {
    await finalizeDesktopArtifacts({ root: resolve(input.root), version: input.version, channel: input.channel, target: input.target })
    return
  }
  if (command === 'index') {
    await buildDesktopReleaseIndex({ root: resolve(input.root), version: input.version, channel: input.channel })
    return
  }
  throw new Error('Usage: desktop-release-artifacts.mjs <validate|finalize|index> --version X --channel Y [--root DIR --target mac|win]')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
