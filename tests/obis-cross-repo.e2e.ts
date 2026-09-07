import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { ObisBridgeClient, ObisBridgeError } from '../packages/obis/bridge/src/index.ts'
import {
  bootstrapToken,
  closeOidc,
  createOidcFixture,
  deviceId,
  email,
  environmentId,
  humanGoal,
  kernelBaseUrl,
  requestJson,
  seedEnterprise,
  sessionId,
  startKernel,
  stopKernel,
  subject,
  tenantId,
  userId,
  waitForHealth,
} from './obis-e2e/fixture.ts'
import { fakeAgent, mountGovernedHarness, nativeTool, setHarnessAccessToken } from './obis-e2e/harness.ts'

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
    const tokens = await requestJson<{ accessToken: string }>('/v1/auth/oidc/exchange', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'e2e', idToken: oidc.idToken(), tenantId, deviceId }),
    })
    assert.match(tokens.accessToken, /^obat_/)
    setHarnessAccessToken(tokens.accessToken)

    const client = new ObisBridgeClient({ baseUrl: kernelBaseUrl, tokenProvider: async () => tokens.accessToken })
    const registration = await client.registerInstallation({
      deviceId, deviceName: 'P0 CI Runner', os: 'linux', architecture: 'x64',
      harnessVersion: '0.1.0', bridgeVersion: '0.1.0-rc.0', protocolVersions: ['1.0'],
      capabilities: ['agent', 'tools', 'skills', 'session'], channel: 'canary',
    })
    assert.equal(registration.compatibility.compatible, true)

    const { ctx, approvals } = await mountGovernedHarness(registration.installation.id)
    const agent = fakeAgent()

    console.log('E2E 03/12 Context through native Harness tool + OHP lease')
    const context = await nativeTool(ctx, agent, 'e2e-context', 'obis_context', {
      focus: { objects: ['Order'], skills: ['ReviewOrder'] },
    })
    assert.ok(context.objects)

    // Replaying the adapter's deterministic run key retrieves the same AgentRun
    // without exposing run identity to the model.
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
      tokenProvider: async () => tokens.accessToken,
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
      headers: { authorization: `Bearer ${tokens.accessToken}`, 'OHP-Version': '9.9' },
    })
    assert.equal(mismatch.status, 409)
    const mismatchBody = await mismatch.json() as { error?: { code?: string } }
    assert.equal(mismatchBody.error?.code, 'OHP_VERSION_UNSUPPORTED')

    console.log('OBIS × AI Harness P0 cross-repo compatibility suite: PASS')
  } finally {
    await stopKernel(kernel)
    await closeOidc(oidc.server)
  }
}

await main()
