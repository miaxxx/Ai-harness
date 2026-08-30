/** Desktop-owned Skill, attachment, and ordinary artifact filesystem operations. */

import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { DesktopArtifact, DesktopAttachment, DesktopSkillSummary } from './shared.ts'

const BASIC_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.html', '.htm', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss', '.less', '.py', '.rb', '.go', '.rs', '.java',
  '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.zsh', '.fish', '.sql', '.toml', '.ini',
])
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SCAN_LIMIT = 12_000
const ARTIFACT_LIMIT = 100
const MAX_FILE_BYTES = 25 * 1024 * 1024

interface FileStamp { size: number; mtimeMs: number }

function mediaType(path: string): string {
  const extension = extname(path).toLowerCase()
  return IMAGE_TYPES[extension] ?? ({
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.html': 'text/html', '.htm': 'text/html',
    '.json': 'application/json', '.jsonl': 'application/jsonl', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  } as Record<string, string>)[extension] ?? 'text/plain'
}

function safeSessionName(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 20)
}

function within(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`))
}

function frontmatter(markdown: string): { name?: string; description?: string; userInvocable?: boolean } {
  if (!markdown.startsWith('---\n')) return {}
  const end = markdown.indexOf('\n---', 4)
  if (end === -1) return {}
  const fields: Record<string, string> = {}
  for (const line of markdown.slice(4, end).split('\n')) {
    const match = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line)
    const key = match?.[1]
    const value = match?.[2]
    if (key !== undefined && value !== undefined) fields[key] = value.trim().replace(/^['"]|['"]$/g, '')
  }
  return {
    ...(fields.name === undefined ? {} : { name: fields.name }),
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields['user-invocable'] === undefined ? {} : { userInvocable: fields['user-invocable'] !== 'false' }),
  }
}

async function skillAt(root: string, source: DesktopSkillSummary['source']): Promise<DesktopSkillSummary[]> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const rows: DesktopSkillSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillFile = join(root, entry.name, 'SKILL.md')
    try {
      const meta = frontmatter(await readFile(skillFile, 'utf8'))
      const name = meta.name ?? entry.name
      if (!SKILL_NAME.test(name) || meta.userInvocable === false) continue
      rows.push({
        name,
        description: meta.description ?? '用户可调用的任务说明',
        source,
        removable: source === 'user',
      })
    } catch { /* A directory without a readable SKILL.md is not a Skill. */ }
  }
  return rows
}

async function rejectSymlinks(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error('Skills containing symbolic links cannot be imported')
  if (!info.isDirectory()) return
  for (const entry of await readdir(path)) await rejectSymlinks(join(path, entry))
}

async function snapshotFiles(workspace: string): Promise<Map<string, FileStamp>> {
  const found = new Map<string, FileStamp>()
  const visit = async (directory: string): Promise<void> => {
    if (found.size >= SCAN_LIMIT) return
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.size >= SCAN_LIMIT) return
      if (entry.name === '.git' || entry.name === '.dsh' || entry.name === 'node_modules' || entry.name === 'dist-electron') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && BASIC_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const info = await stat(path)
        if (info.size <= MAX_FILE_BYTES) found.set(path, { size: info.size, mtimeMs: info.mtimeMs })
      }
    }
  }
  await visit(workspace)
  return found
}

function run(command: string, args: readonly string[], cwd?: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, [...args], { stdio: 'ignore', ...(cwd === undefined ? {} : { cwd }) })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${code ?? 'no status'}`))
    })
  })
}

/** Stateful Desktop content store; privileged paths never cross into arbitrary Renderer operations. */
export class DesktopContentStore {
  private readonly attachments = new Map<string, Map<string, DesktopAttachment>>()
  private readonly artifacts = new Map<string, DesktopArtifact[]>()
  private readonly roots = new Map<string, string>()
  private readonly turns = new Map<string, number>()

  constructor(
    private readonly userSkillsRoot: string,
    private readonly bundledSkillsRoot: () => string,
  ) {}

  sessionRoot(sessionId: string, cwd: string): string {
    const root = join(resolve(cwd), '.dsh', 'artifacts', safeSessionName(sessionId))
    this.roots.set(sessionId, root)
    return root
  }

  async listSkills(cwd: string): Promise<DesktopSkillSummary[]> {
    const groups = await Promise.all([
      skillAt(join(cwd, '.dsh', 'skills'), 'project'),
      skillAt(join(cwd, '.agents', 'skills'), 'project'),
      skillAt(this.userSkillsRoot, 'user'),
      skillAt(this.bundledSkillsRoot(), 'bundled'),
    ])
    const effective = new Map<string, DesktopSkillSummary>()
    for (const row of groups.flat()) if (!effective.has(row.name)) effective.set(row.name, row)
    return [...effective.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  async importSkill(sourcePath: string): Promise<DesktopSkillSummary> {
    const info = await stat(sourcePath)
    const sourceDirectory = info.isDirectory() ? sourcePath : resolve(sourcePath, '..')
    const sourceFile = info.isDirectory() ? join(sourcePath, 'SKILL.md') : sourcePath
    if (basename(sourceFile) !== 'SKILL.md') throw new Error('Select a Skill folder or its SKILL.md file')
    const meta = frontmatter(await readFile(sourceFile, 'utf8'))
    const name = meta.name ?? basename(sourceDirectory)
    if (!SKILL_NAME.test(name)) throw new Error('Skill name must use lowercase kebab-case')
    await rejectSymlinks(sourceDirectory)
    const destination = join(this.userSkillsRoot, name)
    if (await stat(destination).then(() => true, () => false)) throw new Error(`Skill "${name}" already exists`)
    await mkdir(this.userSkillsRoot, { recursive: true })
    await cp(sourceDirectory, destination, { recursive: true, errorOnExist: true })
    return { name, description: meta.description ?? '用户导入的任务说明', source: 'user', removable: true }
  }

  async removeSkill(name: string): Promise<void> {
    if (!SKILL_NAME.test(name)) throw new Error('Invalid Skill name')
    const destination = resolve(this.userSkillsRoot, name)
    if (!within(resolve(this.userSkillsRoot), destination)) throw new Error('Invalid Skill path')
    await rm(destination, { recursive: true })
  }

  async stageAttachments(sessionId: string, cwd: string, paths: readonly string[]): Promise<DesktopAttachment[]> {
    const root = join(this.sessionRoot(sessionId, cwd), 'inputs')
    await mkdir(root, { recursive: true })
    const session = this.attachments.get(sessionId) ?? new Map<string, DesktopAttachment>()
    this.attachments.set(sessionId, session)
    const added: DesktopAttachment[] = []
    for (const source of paths) {
      const info = await stat(source)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error(`Attachment is not a supported file or exceeds 25 MB: ${basename(source)}`)
      const extension = extname(source).toLowerCase()
      const imageType = IMAGE_TYPES[extension]
      if (imageType === undefined && !BASIC_EXTENSIONS.has(extension)) throw new Error(`Unsupported attachment type: ${extension || 'unknown'}`)
      const id = randomUUID()
      const destination = join(root, `${id}-${basename(source)}`)
      await cp(source, destination)
      const row: DesktopAttachment = {
        id, name: basename(source), path: destination, mediaType: mediaType(source),
        kind: imageType === undefined ? 'file' : 'image', size: info.size,
      }
      session.set(id, row)
      added.push(row)
    }
    return added
  }

  async removeAttachment(sessionId: string, id: string): Promise<void> {
    const row = this.attachments.get(sessionId)?.get(id)
    if (row === undefined) return
    this.attachments.get(sessionId)?.delete(id)
    await rm(row.path, { force: true })
  }

  async promptBlocks(sessionId: string, ids: readonly string[]): Promise<ContentBlock[]> {
    const session = this.attachments.get(sessionId)
    const blocks: ContentBlock[] = []
    for (const id of ids) {
      const row = session?.get(id)
      if (row === undefined) throw new Error('One selected attachment is no longer available')
      if (row.kind === 'image') {
        blocks.push({ type: 'image', mimeType: row.mediaType, data: (await readFile(row.path)).toString('base64') })
      } else {
        blocks.push({ type: 'resource_link', name: row.name, uri: pathToFileURL(row.path).href, mimeType: row.mediaType, size: row.size })
      }
    }
    return blocks
  }

  consumeAttachments(sessionId: string, ids: readonly string[]): void {
    const session = this.attachments.get(sessionId)
    for (const id of ids) session?.delete(id)
  }

  snapshot(cwd: string): Promise<Map<string, FileStamp>> { return snapshotFiles(resolve(cwd)) }

  async captureArtifacts(
    sessionId: string,
    cwd: string,
    before: ReadonlyMap<string, FileStamp>,
  ): Promise<DesktopArtifact[]> {
    const after = await snapshotFiles(resolve(cwd))
    const changed = [...after].filter(([path, stamp]) => {
      const previous = before.get(path)
      return previous === undefined || previous.size !== stamp.size || previous.mtimeMs !== stamp.mtimeMs
    }).slice(0, ARTIFACT_LIMIT)
    if (changed.length === 0) return []
    const turn = (this.turns.get(sessionId) ?? 0) + 1
    this.turns.set(sessionId, turn)
    const root = this.sessionRoot(sessionId, cwd)
    const turnRoot = join(root, `turn-${String(turn).padStart(4, '0')}`)
    const rows: DesktopArtifact[] = []
    for (const [source, stamp] of changed) {
      const sourceRelative = relative(resolve(cwd), source)
      if (sourceRelative.startsWith('..')) continue
      const destination = join(turnRoot, sourceRelative)
      await mkdir(resolve(destination, '..'), { recursive: true })
      await cp(source, destination)
      rows.push({ name: basename(source), path: destination, relativePath: sourceRelative, mediaType: mediaType(source), size: stamp.size })
    }
    const all = [...(this.artifacts.get(sessionId) ?? []), ...rows]
    this.artifacts.set(sessionId, all)
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify({ sessionId, artifacts: all }, null, 2)}\n`)
    return rows
  }

  async copyArtifact(sessionId: string, source: string, destination: string): Promise<void> {
    const row = this.artifacts.get(sessionId)?.find(item => item.path === source)
    if (row === undefined) throw new Error('Artifact does not belong to this Session')
    await cp(row.path, destination)
  }

  async exportZip(sessionId: string, destination: string): Promise<void> {
    const root = this.roots.get(sessionId)
    if (root === undefined || (this.artifacts.get(sessionId)?.length ?? 0) === 0) throw new Error('This Session has no artifacts to export')
    await rm(destination, { force: true })
    await run('/usr/bin/zip', ['-q', '-r', destination, '.', '-x', 'inputs/*'], root)
  }
}
