import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildDesktopReleaseIndex, finalizeDesktopArtifacts, releaseChannelForVersion, validateRelease } from './desktop-release-artifacts.mjs'

test('release versions map to the exact configured channel', () => {
  assert.equal(releaseChannelForVersion('1.2.3'), 'stable')
  assert.equal(releaseChannelForVersion('1.2.3-rc.2'), 'beta')
  assert.equal(releaseChannelForVersion('1.2.3-canary.4'), 'canary')
  assert.equal(releaseChannelForVersion('1.2.3-enterprise-lts.1'), 'enterprise-lts')
  assert.throws(() => validateRelease('1.2.3-rc.2', 'stable'), /belongs to beta/)
})

test('finalizer creates channel aliases and non-colliding target manifests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-release-'))
  try {
    const mac = join(root, 'mac')
    const win = join(root, 'win')
    await Promise.all([import('node:fs/promises').then(fs => fs.mkdir(mac)), import('node:fs/promises').then(fs => fs.mkdir(win))])
    await writeFile(join(mac, 'Orbis AI-1.2.3-beta.1-mac-x64.dmg'), 'x64-dmg')
    await writeFile(join(mac, 'Orbis AI-1.2.3-beta.1-mac-arm64.dmg'), 'arm64-dmg')
    await writeFile(join(mac, 'Orbis AI-1.2.3-beta.1-mac-x64.zip'), 'x64-zip')
    await writeFile(join(mac, 'Orbis AI-1.2.3-beta.1-mac-arm64.zip'), 'arm64-zip')
    await writeFile(join(mac, 'beta-mac.yml'), 'version: 1.2.3-beta.1\n')
    await writeFile(join(win, 'Orbis AI-1.2.3-beta.1-win-x64.exe'), 'installer')
    await writeFile(join(win, 'beta.yml'), 'version: 1.2.3-beta.1\n')

    await finalizeDesktopArtifacts({ root: mac, version: '1.2.3-beta.1', channel: 'beta', target: 'mac' })
    await finalizeDesktopArtifacts({ root: win, version: '1.2.3-beta.1', channel: 'beta', target: 'win' })
    assert.match(await readFile(join(mac, 'latest-mac.yml'), 'utf8'), /1.2.3-beta.1/)
    assert.match(await readFile(join(win, 'latest.yml'), 'utf8'), /1.2.3-beta.1/)

    const merged = join(root, 'merged')
    const { mkdir, cp } = await import('node:fs/promises')
    await mkdir(merged)
    await cp(mac, join(merged, 'mac'), { recursive: true })
    await cp(win, join(merged, 'win'), { recursive: true })
    const index = await buildDesktopReleaseIndex({ root: merged, version: '1.2.3-beta.1', channel: 'beta' })
    assert.deepEqual(index.targets.map(value => value.target), ['mac', 'win'])
    assert.ok(index.files.some(value => value.file.endsWith('release-manifest-mac.json')))
    assert.ok(index.files.some(value => value.file.endsWith('release-manifest-win.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mac finalization fails if either release architecture is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-release-missing-'))
  try {
    await writeFile(join(root, 'Orbis AI-1.0.0-mac-x64.dmg'), 'x')
    await writeFile(join(root, 'Orbis AI-1.0.0-mac-x64.zip'), 'x')
    await writeFile(join(root, 'latest-mac.yml'), 'version: 1.0.0\n')
    await assert.rejects(() => finalizeDesktopArtifacts({ root, version: '1.0.0', channel: 'stable', target: 'mac' }), /arm64/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
