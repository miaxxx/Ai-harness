/**
 * Prevent model-facing tool packages from bypassing capability/execution seams.
 *
 * This is deliberately a small ratchet, not a policy compiler. It catches the
 * common architectural bypasses that are mechanically unambiguous:
 * direct child-process creation, obvious Node filesystem mutation imports, and
 * dependencies on concrete sandbox/executor providers. Read-only Node fs
 * helpers and the abstract dsh-sandbox / sandbox-policy seams remain legal.
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

interface Violation {
  file: string
  specifier: string
  reason: string
}

interface StaticImport {
  clause: string
  specifier: string
}

const FS_MODULES = new Set(['node:fs', 'node:fs/promises', 'fs', 'fs/promises'])
const FS_MUTATION_EXPORTS = new Set([
  'appendFile',
  'chmod',
  'chown',
  'copyFile',
  'cp',
  'createWriteStream',
  'fchmod',
  'fchown',
  'ftruncate',
  'futimes',
  'lchmod',
  'lchown',
  'link',
  'lutimes',
  'mkdir',
  'mkdtemp',
  'rename',
  'rm',
  'rmdir',
  'symlink',
  'truncate',
  'unlink',
  'utimes',
  'write',
  'writeFile',
])

function portable(value: string): string {
  return value.split(sep).join('/')
}

/** Static ESM imports preserve enough syntax to distinguish read-only fs use. */
function staticImports(source: string): StaticImport[] {
  const result: StaticImport[] = []
  const pattern = /\bimport\s+(type\s+)?([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) continue
    if (match[2] !== undefined && match[3] !== undefined) {
      result.push({ clause: match[2].trim(), specifier: match[3] })
    }
  }
  return result
}

function otherImports(source: string): string[] {
  const result: string[] = []
  for (const pattern of [
    /\b(?:export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) result.push(match[1])
    }
  }
  return result
}

function namedImports(clause: string): string[] | undefined {
  const open = clause.indexOf('{')
  const close = clause.lastIndexOf('}')
  if (open < 0 || close <= open) return undefined
  return clause.slice(open + 1, close)
    .split(',')
    .map(part => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/u)[0]?.trim())
    .filter((name): name is string => name !== undefined && name.length > 0)
}

function concreteSandboxReason(specifier: string): string | undefined {
  // These two packages are capability/policy vocabulary, not OS providers.
  if (specifier === '@deepseek-ai/dsh-sandbox' || specifier.startsWith('@deepseek-ai/dsh-sandbox/')) return undefined
  if (specifier === '@deepseek-ai/dsh-sandbox-policy' || specifier.startsWith('@deepseek-ai/dsh-sandbox-policy/')) return undefined
  if (/^@deepseek-ai\/dsh-(?:sandbox-.+|.+-sandbox)(?:$|\/)/u.test(specifier)) {
    return 'model-facing tools must depend on sandbox capability seams, not concrete sandbox/executor providers'
  }
  return undefined
}

function staticImportReason(entry: StaticImport): string | undefined {
  const { clause, specifier } = entry
  if (specifier === 'node:child_process' || specifier === 'child_process') {
    return 'model-facing tools must invoke process capability seams, not child_process directly'
  }
  const sandbox = concreteSandboxReason(specifier)
  if (sandbox !== undefined) return sandbox
  if (!FS_MODULES.has(specifier)) return undefined

  const names = namedImports(clause)
  // Namespace/default imports can reach mutation APIs without another import, so
  // keep them outside model-facing tool packages. Named read-only imports are fine.
  if (names === undefined) {
    return 'model-facing tools must not import the Node fs namespace/default; use a capability seam for mutations'
  }
  const mutations = names.filter(name => FS_MUTATION_EXPORTS.has(name))
  if (mutations.length > 0) {
    return `model-facing tools must invoke filesystem capability seams for mutations (${mutations.join(', ')})`
  }
  return undefined
}

function nonStaticImportReason(specifier: string): string | undefined {
  if (specifier === 'node:child_process' || specifier === 'child_process') {
    return 'model-facing tools must invoke process capability seams, not child_process directly'
  }
  const sandbox = concreteSandboxReason(specifier)
  if (sandbox !== undefined) return sandbox
  // Dynamic/require access cannot be narrowed to a read-only named import.
  if (FS_MODULES.has(specifier)) {
    return 'dynamic/require Node fs access is not auditable as read-only; use a capability seam instead'
  }
  return undefined
}

function toolPackageRoots(): string[] {
  const roots: string[] = []
  for (const manifest of globSync('packages/**/package.json', { cwd: root })) {
    const full = join(root, manifest)
    const parsed = JSON.parse(readFileSync(full, 'utf8')) as { name?: unknown }
    if (typeof parsed.name !== 'string' || !parsed.name.startsWith('@deepseek-ai/dsh-tool-')) continue
    roots.push(dirname(full))
  }
  return roots.sort()
}

function main(): void {
  const violations: Violation[] = []
  const tools = toolPackageRoots()
  for (const pkg of tools) {
    for (const rel of globSync('src/**/*.{ts,tsx,js,jsx,mjs,cjs}', { cwd: pkg })) {
      const file = join(pkg, rel)
      const source = readFileSync(file, 'utf8')
      for (const entry of staticImports(source)) {
        const reason = staticImportReason(entry)
        if (reason !== undefined) {
          violations.push({ file: portable(relative(root, file)), specifier: entry.specifier, reason })
        }
      }
      for (const specifier of otherImports(source)) {
        const reason = nonStaticImportReason(specifier)
        if (reason !== undefined) {
          violations.push({ file: portable(relative(root, file)), specifier, reason })
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`verify-side-effect-boundaries: ${violations.length} violation(s):`)
    for (const violation of violations) {
      console.error(`  ${violation.file} -> ${violation.specifier}\n    ${violation.reason}`)
    }
    process.exitCode = 1
    return
  }
  console.log(`verify-side-effect-boundaries: ${tools.length} model-facing tool package(s) clean.`)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
