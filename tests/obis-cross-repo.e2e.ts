import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CredentialProvider, {
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { ObisBridgeClient, ObisBridgeError } from '../packages/obis/bridge/src/index.ts'
import * as toolObis from '../packages/obis/tool-obis/src/index.ts'

const kernelDir = resolve(process.env.OBIS_E2E_KERNEL_DIR ?? '_compat/obis/10-kernel')
const kernelPort = Number(process.env.OBIS_E2E_KERNEL_PORT ?? '4317')
const kernelBaseUrl = `http://127.0.0.1:${kernelPort}`
const databaseUrl = process.env.OBIS_DATABASE_URL
const bootstrapToken = 'e2e-bootstrap-token'
const tenantId = 'e2e-tenant'
const environmentId = 'prod'
const userId = 'e2e-user'
const subject = 'e2e-subject'
const email = 'e2e@example.test'
const deviceId = 'e2e-device'
const sessionId = 'e2e-harness-session'
const humanGoal = 'Create a governed order for the P0 compatibility test.'

if (!databaseUrl) throw new Error('OBIS_DATABASE_URL is required for the cross-repo E2E suite.')

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function jsonResponse(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function createOidcFixture(): Promise<{
  server: Server
  issuer: string
  audience: string
  idToken(): string
}> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  Object.assign(jwk, { kid: 'e2e-key', use: 'sig', alg: 'RS256' })
  const audience = 'obis-e2e'
  let issuer = ''
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/openid-configuration') {
      return jsonResponse(res, 200, { issuer, jwks_uri: `${issuer}/jwks` })
    }
    if (req.url === '/jwks') return jsonResponse(res, 200, { keys: [jwk] })
    return jsonResponse(res, 404, { error: 'not found' })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('OIDC fixture did not bind a TCP port.')
  issuer = `http://127.0.0.1:${address.port}`
  return {
    server,
    issuer,
    audience,
    idToken() {
      const now = Math.floor(Date.now() / 1000)
      const encodedHeader = b64url({ alg: 'RS256', kid: 'e2e-key', typ: 'JWT' })
      const encodedPayload = b64url({
        iss: issuer,
        aud: audience,
        sub: subject,
        email,
        email_verified: true,
        name: 'OBIS E2E User',
        iat: now,
        exp: now + 300,
      })
      const signingInput = `${encodedHeader}.${encodedPayload}`
      const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')
      return `${signingInput}.${signature}`
    },
  }
}

async function waitForHealth(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${kernelBaseUrl}/health`)
      if (response.ok) {
        const body = await response.json() as Record<string, unknown>
        assert.equal(body.persistence, 'postgres')
        return
      }
    } catch (error) { lastError = error }
    await new Promise(resolveWait => setTimeout(resolveWait, 150))
  }
  throw new Error(`OBIS Kernel did not become healthy: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function startKernel(mode: 'legacy' | 'required', oidc?: { issuer: string; audience: string }): ChildProcess {
  const tsx = join(kernelDir, 'node_modules', '.bin', 'tsx')
  const child = spawn(tsx, ['src/server.ts'], {
    cwd: kernelDir,
    env: {
      ...process.env,
      OBIS_DATABASE_URL: databaseUrl,
      OBIS_KERNEL_HOST: '127.0.0.1',
      OBIS_KERNEL_PORT: String(kernelPort),
      OBIS_AUTH_MODE: mode,
      OBIS_BOOTSTRAP_TOKEN: bootstrapToken,
      OBIS_CAPABILITY_LEASE_MODE: mode === 'required' ? 'required' : 'optional',
      OBIS_REQUIRED_HARNESS_CAPABILITIES_JSON: JSON.stringify(['agent', 'tools', 'skills', 'session']),
      ...(oidc ? {
        OBIS_OIDC_PROVIDERS_JSON: JSON.stringify([{
          id: 'e2e',
          issuer: oidc.issuer,
          audience: oidc.audience,
          discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        }]),
      } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', chunk => process.stdout.write(`[obis] ${String(chunk)}`))
  child.stderr?.on('data', chunk => process.stderr.write(`[obis] ${String(chunk)}`))
  return child
}

async function stopKernel(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit'),
    new Promise<void>((resolveWait) => setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      resolveWait()
    }, 5_000)),
  ])
}

async function requestJson<T>(path: string, init: RequestInit = {}, expected: number | number[] = 200): Promise<T> {
  const response = await fetch(`${kernelBaseUrl}${path}`, init)
  const text = await response.text()
  const body = text ? JSON.parse(text) as T : undefined as T
  const accepted = Array.isArray(expected) ? expected : [expected]
  assert.ok(accepted.includes(response.status), `${init.method ?? 'GET'} ${path}: expected ${accepted.join('/')}, got ${response.status}: ${text}`)
  return body
}

const packSource = JSON.stringify({
  specVersion: '1.0',
  kind: 'ObisPack',
  metadata: { name: 'p0-e2e', namespace: 'test.p0.e2e', version: '1.0.0' },
  definitions: {
    objects: [{
      name: 'Order',
      properties: {
        amount: { type: 'number' },
        status: { type: 'string' },
      },
    }],
    policies: [
      { name: 'OwnerActions', effect: 'allow', actions: ['createOrder'], objects: ['Order'], roles: ['owner'] },
      { name: 'OwnerRead', effect: 'allow', queries: ['ListOrders'], objects: ['Order'], roles: ['owner'] },
      { name: 'DeniedRead', effect: 'deny', queries: ['DeniedOrders'], objects: ['Order'], roles: ['owner'] },
    ],
    actions: [{
      name: 'createOrder',
      target: 'Order',
      input: {
        amount: { type: 'number', required: true },
        status: { type: 'string', required: true },
      },
      policy: 'OwnerActions',
      executor: 'obis.object.create',
      risk: 'low',
    }],
    queries: [
      { name: 'ListOrders', object: 'Order', policy: 'OwnerRead', fields: ['amount', 'status'], defaultLimit: 20, maxLimit: 100 },
      { name: 'DeniedOrders', object: 'Order', policy: 'DeniedRead', fields: ['amount', 'status'], defaultLimit: 20, maxLimit: 100 },
    ],
    skills: [{ name: 'ReviewOrder', description: 'Review an order before a governed action.' }],
  },
})

const packManifest = {
  manifestVersion: '1.0',
  metadata: { name: 'p0-e2e', namespace: 'test.p0.e2e', version: '1.0.0' },
  layer: 'domain',
  compatibility: { kernel: '>=0.1.0', ir: '1.0' },
}

async function seedEnterprise(): Promise<void> {
  await requestJson('/v1/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: tenantId, name: 'P0 E2E Tenant' }),
  }, [200, 201])
  await requestJson('/v1/environments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: environmentId, tenantId, name: 'Production' }),
  }, [200, 201])
  const compiled = await requestJson<{ ir?: { artifactId?: string }; diagnostics?: unknown[] }>('/v1/packs/compile', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: packSource, manifest: packManifest }),
  })
  assert.equal(compiled.diagnostics?.length ?? 0, 0, `Pack compile diagnostics: ${JSON.stringify(compiled.diagnostics)}`)
  assert.equal(typeof compiled.ir?.artifactId, 'string')
  await requestJson('/v1/deployments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId, environmentId, artifactIds: [compiled.ir!.artifactId] }),
  }, 201)
}

class TokenCredentialProvider extends CredentialProvider {
  constructor(private readonly token: () => string) { super() }
  async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return { value: this.token(), source: 'e2e' } }
  async describe(_ref: CredentialRef): Promise<CredentialInfo> { return { configured: true, source: 'e2e', writable: false } }
  async set(): Promise<void> { throw new Error('read-only') }
  async unset(): Promise<void> { throw new Error('read-only') }
  async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> { return undefined }
  async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> { return { configured: false, writable: false } }
  async listRecords(): Promise<readonly CredentialRecordEntry[]> { return [] }
  async modifyRecord(_key: CredentialKey, _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> { return undefined }
  async deleteRecord(): Promise<void> {}
}

function fakeAgent(id = sessionId): Agent {
  const events: Array<Record<string, unknown>> = [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'user/message',
      data: {
        id: 'e2e-message', role: 'user',
        content: [{ type: 'text', text: humanGoal }],
        source: { kind: 'user' },
      },
    },
  ]
  const session = {
    events,
    append(type: string, data: Record<string, unknown>) {
      const event = { type, data }
      events.push(event)
      return event
    },
  }
  return { id, session } as unknown as Agent
}

type ToolCallId = Parameters<ToolRuntime['execute']>[0]['callId']

async function nativeTool(ctx: Context, agent: Agent, callId: string, name: string, args: Record<string, unknown>) {
  const result = await ctx.tools.execute({
    callId: callId as ToolCallId,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(result.isError, false, result.isError ? result.error.message : undefined)
  if (result.isError) throw result.error
  return result.value as Record<string, unknown>
}

async function main(): Promise<void> {
  const oidc = await createOidcFixture()
  let kernel: ChildProcess | undefined
  try {
    console.log('E2E 01/12 seed durable enterprise state')
    kernel = startKernel('legacy')
    await waitForHealth()
    await seedEnterprise()
    await stopKernel(kernel)

    console.log('E2E 02/12 Login via signed local OIDC')
    kernel = startKernel('required', oidc)
    await waitForHealth()
    await requestJson('/v1/platform/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-obis-bootstrap-token': bootstrapToken },
      body: JSON.stringify({
        tenantId, userId, email, displayName: 'OBIS E2E User', provider: 'e2e', subject,
        roles: ['owner'],
      }),
    }, [200, 201])
    const tokens = await requestJson<{ accessToken: string; refreshToken: string }>('/v1/auth/oidc/exchange', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'e2e', idToken: oidc.idToken(), tenantId, deviceId }),
    })
    assert.match(tokens.accessToken, /^obat_/)

    let accessToken = tokens.accessToken
    const client = new ObisBridgeClient({ baseUrl: kernelBaseUrl, tokenProvider: async () => accessToken })
    const registration = await client.registerInstallation({
      deviceId, deviceName: 'P0 CI Runner', os: 'linux', architecture: 'x64',
      harnessVersion: '0.1.0', bridgeVersion: '0.1.0-rc.0', protocolVersions: ['1.0'],
      capabilities: ['agent', 'tools', 'skills', 'session'], channel: 'canary',
    })
    assert.equal(registration.compatibility.compatible, true)

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TokenCredentialProvider, () => accessToken)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(toolObis, {
      baseUrl: kernelBaseUrl,
      environmentId,
      credentialRef: 'OBIS_ACCESS_TOKEN',
      installationId: registration.installation.id,
      autonomy: 'human-approved',
    })
    const agent = fakeAgent()
    const approvals: string[] = []
    ctx.on('approval/request', (request) => {
      approvals.push(request.reason ?? '')
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    console.log('E2E 03/12 Context through native Harness tool + OHP lease')
    const context = await nativeTool(ctx, agent, 'e2e-context', 'obis_context', { focus: { objects: ['Order'], skills: ['ReviewOrder'] } })
    assert.ok(context.objects)

    const boundRun = await client.createAgentRun({
      environmentId, agentId: 'workspace', goal: humanGoal, autonomy: 'human-approved',
    }, { idempotencyKey: `workspace:${sessionId}` })
    const attached = await client.attachAgentRun(boundRun.id, {
      environmentId, harnessSessionId: sessionId, installationId: registration.installation.id,
    })
    assert.equal(attached.harnessSessionId, sessionId)
    assert.ok(attached.capabilityLease?.id)
    const governed = { agentRunId: boundRun.id, capabilityLease: attached.capabilityLease!.id }

    console.log('E2E 04/12 Query through native Harness tool')
    const before = await nativeTool(ctx, agent, 'e2e-query-before', 'obis_query', { query: 'ListOrders' })
    assert.equal(before.status, 'executed')
    assert.deepEqual(before.items, [])

    console.log('E2E 05/12 Skill discovery through OHP')
    const skills = await client.listSkills(environmentId, governed)
    assert.ok(skills.some(skill => skill.name === 'ReviewOrder'))

    console.log('E2E 06/12 Proposal + native human approval + adapter-internal execute')
    const action = await nativeTool(ctx, agent, 'e2e-proposal', 'obis_propose_action', {
      action: 'createOrder', targetId: 'order-e2e-1', input: { amount: 125, status: 'open' },
    })
    assert.deepEqual(action.confirmation, { outcome: 'allowed-once' })
    const execution = action.execution as Record<string, unknown>
    const executionResult = execution.result as Record<string, unknown>
    assert.equal(executionResult.status, 'executed')
    assert.equal(approvals.length, 1)
    assert.equal(ctx.tools.schemas(agent).some(schema => schema.name === 'obis_execute_action'), false)

    console.log('E2E 07/12 Query observes committed enterprise mutation')
    const after = await nativeTool(ctx, agent, 'e2e-query-after', 'obis_query', { query: 'ListOrders' })
    assert.equal(after.status, 'executed')
    const items = after.items as Array<{ id: string; values: Record<string, unknown> }>
    assert.deepEqual(items.map(item => item.id), ['order-e2e-1'])
    assert.deepEqual(items[0]?.values, { amount: 125, status: 'open' })

    console.log('E2E 08/12 Task read reflects completed governed work')
    const completedRun = await client.getAgentRun(boundRun.id, environmentId)
    const task = await client.getTask(completedRun.taskId, environmentId, governed)
    assert.equal(task.status, 'completed')

    console.log('E2E 09/12 Policy denial fails closed')
    await assert.rejects(
      client.executeQuery(environmentId, 'DeniedOrders', {}, governed),
      (error: unknown) => error instanceof ObisBridgeError && error.status === 403 && error.code === 'OHP_FORBIDDEN',
    )

    console.log('E2E 10/12 restart/resume keeps AgentRun, Task and Harness binding durable')
    const resumable = await client.createAgentRun({
      environmentId, agentId: 'workspace', goal: 'Resume this governed run after restart.', autonomy: 'human-approved',
    }, { idempotencyKey: 'restart-resume-run' })
    const resumeAttached = await client.attachAgentRun(resumable.id, {
      environmentId, harnessSessionId: 'resume-session', installationId: registration.installation.id,
    })
    assert.ok(resumeAttached.capabilityLease?.id)
    await stopKernel(kernel)
    kernel = startKernel('required', oidc)
    await waitForHealth()
    const resumed = await client.getAgentRun(resumable.id, environmentId)
    assert.equal(resumed.harnessSessionId, 'resume-session')
    const reattached = await client.attachAgentRun(resumable.id, {
      environmentId, harnessSessionId: 'resume-session', installationId: registration.installation.id,
    })
    assert.ok(reattached.capabilityLease?.id)
    const resumedTask = await client.getTask(resumed.taskId, environmentId, {
      agentRunId: resumable.id, capabilityLease: reattached.capabilityLease!.id,
    })
    assert.ok(['open', 'running', 'waiting', 'waiting-approval'].includes(String(resumedTask.status)))

    console.log('E2E 11/12 network interruption replay returns the committed idempotent AgentRun')
    const realFetch = globalThis.fetch
    let dropped = false
    const lossyClient = new ObisBridgeClient({
      baseUrl: kernelBaseUrl,
      tokenProvider: async () => accessToken,
      fetch: async (input, init) => {
        const response = await realFetch(input, init)
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
        if (!dropped && url.pathname === '/v1/agent-runs' && init?.method === 'POST') {
          dropped = true
          await response.arrayBuffer()
          throw new TypeError('simulated response loss after OBIS commit')
        }
        return response
      },
    })
    const lossyInput = { environmentId, agentId: 'workspace', goal: 'Network replay safety.', autonomy: 'human-approved' }
    await assert.rejects(lossyClient.createAgentRun(lossyInput, { idempotencyKey: 'network-loss-run' }), /simulated response loss/)
    const replayed = await client.createAgentRun(lossyInput, { idempotencyKey: 'network-loss-run' })
    const replayedAgain = await client.createAgentRun(lossyInput, { idempotencyKey: 'network-loss-run' })
    assert.equal(replayed.id, replayedAgain.id)

    console.log('E2E 12/12 OHP version mismatch is rejected before authority use')
    const mismatch = await fetch(`${kernelBaseUrl}/v1/harness/skills?environmentId=${environmentId}`, {
      headers: { authorization: `Bearer ${accessToken}`, 'OHP-Version': '9.9' },
    })
    assert.equal(mismatch.status, 409)
    const mismatchBody = await mismatch.json() as { error?: { code?: string } }
    assert.equal(mismatchBody.error?.code, 'OHP_VERSION_UNSUPPORTED')

    console.log('OBIS × AI Harness P0 cross-repo compatibility suite: PASS')
  } finally {
    await stopKernel(kernel)
    oidc.server.close()
    await once(oidc.server, 'close').catch(() => undefined)
  }
}

await main()
