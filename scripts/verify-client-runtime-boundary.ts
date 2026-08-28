/**
 * Ratchet migrated product clients away from Agent Runtime internals.
 *
 * This is intentionally a small repository guard, not a policy framework.
 * Add a client root here only after that surface has migrated behind ACP.
 *
 * Run directly:
 *   pnpm exec tsx scripts/verify-client-runtime-boundary.ts
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Client surfaces whose runtime dependency migration is complete enough to enforce. */
const PROTECTED_CLIENT_ROOTS = ['apps/desktop'] as const

/** Runtime-internal package families product clients must not reach directly. */
const FORBIDDEN_RUNTIME_PACKAGES = [
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-sandbox',
] as const

interface Violation {
  file: string
  dependency: string
  source: 'source import' | 'package manifest'
}

function portable(path: string): string {
  return path.split(sep).join('/')
}

function forbiddenPackage(specifier: string): string | undefined {
  return FORBIDDEN_RUNTIME_PACKAGES.find(pkg => specifier === pkg || specifier.startsWith(`${pkg}/`))
}

function sourceSpecifiers(source: string): string[] {
  const found: string[] = []
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined) found.push(specifier)
    }
  }
  return found
}

function scanSources(clientRoot: string): Violation[] {
  const violations: Violation[] = []
  for (const rel of globSync('src/**/*.{ts,tsx,js,jsx,mjs,cjs}', { cwd: clientRoot })) {
    const file = join(clientRoot, rel)
    const source = readFileSync(file, 'utf8')
    for (const specifier of sourceSpecifiers(source)) {
      const dependency = forbiddenPackage(specifier)
      if (dependency === undefined) continue
      violations.push({
        file: portable(file.slice(root.length + 1)),
        dependency,
        source: 'source import',
      })
    }
  }
  return violations
}

function scanManifest(clientRoot: string): Violation[] {
  const manifestPath = join(clientRoot, 'package.json')
  if (!existsSync(manifestPath)) return []
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
  const violations: Violation[] = []
  for (const field of dependencyFields) {
    const dependencies = manifest[field]
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
    for (const specifier of Object.keys(dependencies)) {
      const dependency = forbiddenPackage(specifier)
      if (dependency === undefined) continue
      violations.push({
        file: portable(manifestPath.slice(root.length + 1)),
        dependency,
        source: 'package manifest',
      })
    }
  }
  return violations
}

function main(): void {
  const violations: Violation[] = []
  for (const rel of PROTECTED_CLIENT_ROOTS) {
    const clientRoot = join(root, rel)
    if (!existsSync(clientRoot)) {
      console.error(`verify-client-runtime-boundary: configured client root is missing: ${rel}`)
      process.exitCode = 1
      return
    }
    violations.push(...scanManifest(clientRoot), ...scanSources(clientRoot))
  }

  const unique = [...new Map(violations.map(v => [`${v.file}\0${v.dependency}\0${v.source}`, v])).values()]
  if (unique.length > 0) {
    console.error(`verify-client-runtime-boundary: ${unique.length} violation(s):`)
    for (const violation of unique) {
      console.error(`  ${violation.file}: ${violation.source} reaches ${violation.dependency}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`verify-client-runtime-boundary: ${PROTECTED_CLIENT_ROOTS.length} protected client surface(s) clean.`)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
