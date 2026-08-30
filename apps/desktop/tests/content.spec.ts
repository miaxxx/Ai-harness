import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopContentStore } from '../src/desktop-content.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function temporary(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-desktop-content-'))
  roots.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Desktop content store', () => {
  it('imports a user Skill and keeps project and bundled Skills read-only', async () => {
    const root = await temporary()
    const user = join(root, 'user')
    const bundled = join(root, 'bundled')
    const workspace = join(root, 'workspace')
    await mkdir(join(bundled, 'built-in'), { recursive: true })
    await mkdir(join(bundled, 'project-skill'), { recursive: true })
    await mkdir(join(workspace, '.dsh', 'skills', 'project-skill'), { recursive: true })
    await mkdir(join(root, 'source-skill'), { recursive: true })
    await writeFile(join(bundled, 'built-in', 'SKILL.md'), '---\nname: built-in\ndescription: Built in\n---\n')
    await writeFile(join(bundled, 'project-skill', 'SKILL.md'), '---\nname: project-skill\ndescription: Shadowed\n---\n')
    await writeFile(join(workspace, '.dsh', 'skills', 'project-skill', 'SKILL.md'), '---\nname: project-skill\ndescription: Project\n---\n')
    await writeFile(join(root, 'source-skill', 'SKILL.md'), '---\nname: user-skill\ndescription: User\n---\n')
    const store = new DesktopContentStore(user, () => bundled)

    await store.importSkill(join(root, 'source-skill'))
    expect(await store.listSkills(workspace)).toEqual([
      { name: 'built-in', description: 'Built in', source: 'bundled', removable: false },
      { name: 'project-skill', description: 'Project', source: 'project', removable: false },
      { name: 'user-skill', description: 'User', source: 'user', removable: true },
    ])
    await store.removeSkill('user-skill')
    expect((await store.listSkills(workspace)).map(row => row.name)).not.toContain('user-skill')
  })

  it('stages ordinary attachments and captures changed files as Session artifacts', async () => {
    const root = await temporary()
    const workspace = join(root, 'workspace')
    const source = join(root, 'notes.md')
    await mkdir(workspace)
    await writeFile(source, '# Notes\n')
    const store = new DesktopContentStore(join(root, 'skills'), () => join(root, 'bundled'))
    const [attachment] = await store.stageAttachments('session-a', workspace, [source])
    expect(attachment).toMatchObject({ name: 'notes.md', kind: 'file', mediaType: 'text/markdown' })
    expect(await store.promptBlocks('session-a', [attachment!.id])).toMatchObject([
      { type: 'resource_link', name: 'notes.md', mimeType: 'text/markdown' },
    ])

    const before = await store.snapshot(workspace)
    await writeFile(join(workspace, 'result.csv'), 'name,value\na,1\n')
    const artifacts = await store.captureArtifacts('session-a', workspace, before)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ name: 'result.csv', relativePath: 'result.csv', mediaType: 'text/csv' })
    expect(await readFile(artifacts[0]!.path, 'utf8')).toBe('name,value\na,1\n')

    const zip = join(root, 'all.zip')
    await store.exportZip('session-a', zip)
    const listing = await execFileAsync('/usr/bin/unzip', ['-Z1', zip])
    expect(listing.stdout).toContain('turn-0001/result.csv')
    expect(listing.stdout).not.toContain('inputs/')
  })
})
