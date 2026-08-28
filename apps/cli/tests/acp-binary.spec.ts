import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/**
 * Phase-B acceptance: exercise the published CLI as a real process, which in
 * turn owns a fresh ACP Runtime subprocess for every command. Durable Session
 * state is the only bridge between process A and process B.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const acpBin = join(repoRoot, 'packages/examples/acp-demo/lib/bin.js')

interface RunJson {
  sessionId: string
  stopReason: string
  updates: Array<{
    sessionId: string
    update: {
      sessionUpdate: string
      content?: { type: string; text?: string }
    }
  }>
}

interface ListJson {
  sessions: Array<{ sessionId: string; cwd: string }>
  nextCursor?: string
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

async function runCli(
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await execa(process.execPath, [dshBin, ...args], {
    cwd,
    input: '',
    timeout: 30_000,
    killSignal: 'SIGKILL',
    reject: false,
    env: { ...process.env, ...env },
  })
  if (result.timedOut) {
    throw new Error(`dsh ACP command timed out. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { code: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr }
}

function transcript(updates: RunJson['updates']): string[] {
  return updates.flatMap(({ update }) => {
    if (update.content?.type !== 'text' || typeof update.content.text !== 'string') return []
    if (update.sessionUpdate !== 'user_message_chunk' && update.sessionUpdate !== 'agent_message_chunk') return []
    return [`${update.sessionUpdate}:${update.content.text}`]
  })
}

describe.skipIf(!existsSync(dshBin) || !existsSync(acpBin))('dsh built ACP client portability', () => {
  it('creates with CLI A, exits the Runtime, then lists/loads/continues with fresh CLI processes', async () => {
    const project = mkdtempSync(join(tmpdir(), 'dsh-cli-acp-project-'))
    // Keep the config under the examples workspace so Loader resolves the real
    // built workspace packages through examples/node_modules. Session data is
    // still outside the repository and owned by the temporary project.
    const configDir = mkdtempSync(join(repoRoot, 'examples/.cli-acp-e2e-'))
    const persistenceRoot = join(project, '.sessions')
    const configPath = join(configDir, 'cordis.yml')
    const apiKey = 'cli-acp-e2e-key'
    const answer = 'durable answer from the mock'
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

    try {
      const firstQuestion = 'remember alpha from process A'
      const first = await runCli([
        'run', ...runtimeFlags(configPath), '--cwd', project, '--json', firstQuestion,
      ], project, env)
      expect(first.code, first.stderr).toBe(0)
      const firstJson = JSON.parse(first.stdout) as RunJson
      expect(firstJson.sessionId).toBeTruthy()
      expect(firstJson.stopReason).toBe('end_turn')
      expect(transcript(firstJson.updates)).toEqual([
        `user_message_chunk:${firstQuestion}`,
        `agent_message_chunk:${answer}`,
      ])

      // A second CLI process starts a second Runtime process. No in-memory
      // Agent/Session object from the first command can participate here.
      const listed = await runCli([
        'sessions', ...runtimeFlags(configPath), '--cwd', project, '--json',
      ], project, env)
      expect(listed.code, listed.stderr).toBe(0)
      const listJson = JSON.parse(listed.stdout) as ListJson
      expect(listJson.sessions).toContainEqual({ sessionId: firstJson.sessionId, cwd: project })

      const secondQuestion = 'continue beta from process B'
      const second = await runCli([
        'run', ...runtimeFlags(configPath), '--cwd', project,
        '--session', firstJson.sessionId, '--json', secondQuestion,
      ], project, env)
      expect(second.code, second.stderr).toBe(0)
      const secondJson = JSON.parse(second.stdout) as RunJson
      expect(secondJson.sessionId).toBe(firstJson.sessionId)

      // load, unlike resume, must replay the durable presentation before the
      // new prompt's own events arrive.
      expect(transcript(secondJson.updates)).toEqual([
        `user_message_chunk:${firstQuestion}`,
        `agent_message_chunk:${answer}`,
        `user_message_chunk:${secondQuestion}`,
        `agent_message_chunk:${answer}`,
      ])

      expect(server.requests).toHaveLength(2)
      const reconstructed = JSON.stringify(server.requests[1]?.body)
      expect(reconstructed).toContain(firstQuestion)
      expect(reconstructed).toContain(answer)
      expect(reconstructed).toContain(secondQuestion)

      // The JSONL backend, not either Client process, owns durable identity.
      expect(existsSync(persistenceRoot)).toBe(true)
      expect(readFileSync(configPath, 'utf8')).toContain(quoteYaml(persistenceRoot))
    } finally {
      await server.close()
      rmSync(project, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 90_000)
})
