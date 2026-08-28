/**
 * Prevent model-facing tool packages from bypassing capability/execution seams.
 *
 * Tool implementations describe Agent-triggerable actions. They must not mint
 * their own OS side-effect path by importing Node process/filesystem primitives
 * or concrete sandbox providers. Provider/runtime/persistence packages remain
 * free to own those primitives outside this scan.
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

interface Violation {
  file: string
  specifier: string
  reason: string
}

function portable(value: string): string {
  return value.split(sep).join('/')
}

function imports(source: string): string[] {
  const result: string[] = []
  for (const pattern of [
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) result.push(match[1])
    }
  }
  return result
}

function forbiddenReason(specifier: string): string | undefined {
  if (specifier === 'node:child_process' || specifier === 'child_process') {
    return 'model-facing tools must invoke process capability seams, not child_process directly'
  }
  if (specifier === 'node:fs' || specifier === 'node:fs/promises' || specifier === 'fs' || specifier === 'fs/promises') {
    return 'model-facing tools must invoke filesystem capability seams, not Node fs directly'
  }
  if (/^@deepseek-ai\/dsh-(?:sandbox|.*-sandbox)(?:$|\/)/.test(specifier)) {
    return 'model-facing tools must not bind to a concrete sandbox implementation'
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
      for (const specifier of imports(source)) {
        const reason = forbiddenReason(specifier)
        if (reason === undefined) continue
        violations.push({ file: portable(relative(root, file)), specifier, reason })
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
