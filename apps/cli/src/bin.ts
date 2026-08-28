#!/usr/bin/env node
/**
 * dsh — command-line entry.
 *
 * Product ACP modes and Runtime/profile bootstrap are deliberately loaded from
 * disjoint dynamic-import branches. Invoking `dsh run` or `dsh sessions` does
 * not load the Cordis/Agent composition path into the client process.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDshArgs } from './args.ts'

function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const invocation = parseDshArgs(process.argv.slice(2), readVersion())

switch (invocation.mode) {
  case 'acp-run': {
    const { runAcpPrompt } = await import('./client/commands.ts')
    await runAcpPrompt(invocation)
    break
  }
  case 'acp-sessions': {
    const { listAcpSessions } = await import('./client/commands.ts')
    await listAcpSessions(invocation)
    break
  }
  case 'profile': {
    const [{ runProfile }, { loadLayeredEnv }] = await Promise.all([
      import('./profile-boot.ts'),
      import('@deepseek-ai/dsh-app-boot'),
    ])
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
