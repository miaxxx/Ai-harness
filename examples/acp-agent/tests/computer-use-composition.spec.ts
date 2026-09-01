import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-acp-snapshot'
import { cleanupAcpExampleTest } from './cleanup.ts'

const CONFIG = readFileSync(new URL('../cordis.yml', import.meta.url), 'utf8')
const BASE_TOOL_SCHEMAS = JSON.parse(readFileSync(
  new URL('./snapshots/text-turn/tool-schemas.expected.json', import.meta.url),
  'utf8',
)) as { initial?: Array<{ name?: string }> }
const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
}
const COMPUTER_ROWS = [
  'computer',
  'computer-browser-cdp',
  'computer-macos',
  'tool-computer',
] as const

let spawned: LaunchedAcpTestAgent | undefined
let workdir: string | undefined

afterEach(async () => {
  const ownedSpawned = spawned
  const ownedWorkdir = workdir
  spawned = undefined
  workdir = undefined
  await cleanupAcpExampleTest(ownedSpawned, ownedWorkdir)
})

function configRow(id: string): string {
  const marker = `- id: ${id}\n`
  const start = CONFIG.indexOf(marker)
  if (start < 0) throw new Error(`missing ACP config row ${id}`)
  const next = CONFIG.indexOf('\n- id:', start + marker.length)
  return CONFIG.slice(start, next < 0 ? undefined : next)
}

describe('ACP Computer Use composition', () => {
  it('keeps every Computer component behind the same explicit Desktop opt-in', () => {
    for (const id of COMPUTER_ROWS) {
      expect(configRow(id)).toContain(
        "disabled: !!js process.env.DSH_DESKTOP_COMPUTER_USE_ENABLED !== 'true'",
      )
    }
  })

  it('keeps the keyless base snapshot tool surface Computer-free while the feature is off', () => {
    const names = (BASE_TOOL_SCHEMAS.initial ?? []).map(tool => tool.name)
    expect(names).not.toContain('computer')
  })

  it('boots the real ACP product composition with Computer Use enabled', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-computer-use-'))
    spawned = launchAcpTestAgent({
      agent: AGENT,
      cwd: workdir,
      env: {
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'sk-dummy-for-computer-use-boot',
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_DESKTOP_COMPUTER_USE_ENABLED: 'true',
      },
    })

    await spawned.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await spawned.client.newSession({ cwd: workdir, mcpServers: [] })
    expect(sessionId.length).toBeGreaterThan(0)
  }, 60_000)
})
