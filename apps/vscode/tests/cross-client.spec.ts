import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { VscodeAcpClient } from '../src/acp-client.ts'

/**
 * Phase-C acceptance: a CLI-created durable Session is later activated by a
 * fresh VS Code product client + fresh Runtime process. Persistence + ACP are
 * the only hand-off channel between the two clients.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const acpBin = join(repoRoot, 'packages/examples/acp-demo/lib/bin.js')

interface CliRunJson {
  sessionId: string
  stopReason: string
}

function quoteYaml(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function runtimeFlags(configPath: string): string[] {
  return [
    '--runtime-command', process.execPath,
    '--runtime-arg', acpBin,
    '--runtime-arg=--config',
    '--runtime-arg', configPath,
  ]
}

async function createFromCli(
  cwd: string,
  configPath: string,
  env: Readonly<Record<string, string>>,
  prompt: string,
): Promise<CliRunJson> {
  const result = await execa(process.execPath, [
    dshBin,
    'run',
    ...runtimeFlags(configPath),
    '--cwd', cwd,
    '--json',
    prompt,
  ], {
    cwd,
    input: '',
    timeout: 30_000,
    killSignal: 'SIGKILL',
    reject: false,
    env: { ...process.env, ...env },
  })
  if (result.timedOut) throw new Error(`CLI handoff setup timed out: ${result.stderr}`)
  if (result.exitCode !== 0) throw new Error(`CLI handoff setup failed: ${result.stderr}`)
  return JSON.parse(result.stdout) as CliRunJson
}

/** Reconstruct semantic transcript messages from ACP streaming chunks. */
function transcript(updates: readonly SessionNotification[]): string[] {
  const messages: Array<{ kind: 'user_message_chunk' | 'agent_message_chunk'; text: string }> = []

  for (const notification of updates) {
    const update = notification.update
    if (update.sessionUpdate !== 'user_message_chunk' && update.sessionUpdate !== 'agent_message_chunk') continue
    if (update.content.type !== 'text') continue

    const kind = update.sessionUpdate
    const previous = messages.at(-1)
    if (previous?.kind === kind) previous.text += update.content.text
    else messages.push({ kind, text: update.content.text })
  }

  return messages.map(({ kind, text }) => `${kind}:${text}`)
}

describe.skipIf(!existsSync(dshBin) || !existsSync(acpBin))('CLI → VS Code durable ACP handoff', () => {
  it('loads CLI history through ACP replay and continues the same persisted Session', async () => {
    const project = mkdtempSync(join(tmpdir(), 'dsh-vscode-acp-project-'))
    const configDir = mkdtempSync(join(repoRoot, 'examples/.vscode-acp-e2e-'))
    const persistenceRoot = join(project, '.sessions')
    const configPath = join(configDir, 'cordis.yml')
    const apiKey = 'vscode-acp-e2e-key'
    const answer = 'durable answer shared with the IDE'
    const server = await startMockLlmServer({
      sequence: ['success', 'success'],
      apiKey,
      successText: answer,
    })

    writeFileSync(configPath, [
      '- id: llm-deepseek',
      "  name: '@deepseek-ai/dsh-llm-deepseek'",
      '  config:',
      '    models:',
      '      - id: deepseek-v4-flash',
      '- id: acp-agent',
      "  name: '@deepseek-ai/dsh-acp-demo'",
      '  config:',
      '    provider: deepseek-official',
      '    model: deepseek-v4-flash',
      `    persistenceRoot: ${quoteYaml(persistenceRoot)}`,
      '    persistenceCompression: none',
      '    workspaceContext: false',
      '    skills:',
      '      enabled: false',
      '    toolBash: false',
      '    toolJobs: false',
      '    goals: false',
      '',
    ].join('\n'))

    const env = {
      DSH_HOME: join(project, '.dsh'),
      DSH_AGENTS_HOME: join(project, '.agents'),
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: apiKey,
      DEEPSEEK_BASE_URL: server.baseURL,
    }

    let ide: VscodeAcpClient | undefined
    try {
      const cliQuestion = 'remember alpha from the CLI client'
      const created = await createFromCli(project, configPath, env, cliQuestion)
      expect(created.stopReason).toBe('end_turn')

      const updates: SessionNotification[] = []
      ide = new VscodeAcpClient({
        command: process.execPath,
        args: [acpBin, '--config', configPath],
        cwd: project,
        env,
      }, {
        onSessionUpdate(notification) {
          updates.push(notification)
        },
        onPermissionRequest() {
          return Promise.resolve({ outcome: { outcome: 'cancelled' } })
        },
      })

      const listed = await ide.listSessions(project)
      expect(listed.sessions).toContainEqual(expect.objectContaining({
        sessionId: created.sessionId,
        cwd: project,
      }))

      await ide.loadSession(created.sessionId, project)
      expect(ide.activeSessionId).toBe(created.sessionId)
      expect(transcript(updates)).toEqual([
        `user_message_chunk:${cliQuestion}`,
        `agent_message_chunk:${answer}`,
      ])

      const ideQuestion = 'continue beta from the VS Code client'
      await expect(ide.prompt(ideQuestion)).resolves.toMatchObject({ stopReason: 'end_turn' })
      expect(transcript(updates)).toEqual([
        `user_message_chunk:${cliQuestion}`,
        `agent_message_chunk:${answer}`,
        `user_message_chunk:${ideQuestion}`,
        `agent_message_chunk:${answer}`,
      ])

      expect(server.requests).toHaveLength(2)
      const reconstructed = JSON.stringify(server.requests[1]?.body)
      expect(reconstructed).toContain(cliQuestion)
      expect(reconstructed).toContain(answer)
      expect(reconstructed).toContain(ideQuestion)

      await ide.dispose()
      ide = undefined
    } finally {
      await ide?.dispose().catch(() => {})
      await server.close()
      rmSync(project, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 90_000)
})
