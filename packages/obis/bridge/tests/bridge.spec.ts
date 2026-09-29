import { describe, expect, it } from 'vitest'
import { ObisBridgeClient } from '../src/client.ts'
import { bindObisRun } from '../src/run-binding.ts'
import { createObisTools } from '../src/tools.ts'

interface SeenRequest {
  url: string
  method: string
  headers: Headers
  body: unknown
}

function mockClient() {
  const seen: SeenRequest[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const text = await request.text()
    const body = text ? JSON.parse(text) as unknown : undefined
    seen.push({ url: request.url, method: request.method, headers: request.headers, body })

    if (request.url.endsWith('/v1/agent-runs') && request.method === 'POST') {
      return new Response(JSON.stringify({ id: 'run-1', environmentId: 'production', status: 'running' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (request.url.endsWith('/v1/agent-runs/run-1/attach') && request.method === 'POST') {
      return new Response(JSON.stringify({ id: 'run-1', harnessSessionId: 'session-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (request.url.includes('/v1/agent-runs/run-1/events?')) {
      const first = {
        id: 'event-1', type: 'planning', runId: 'run-1', occurredAt: '2026-09-07T00:00:00.000Z',
        correlationId: 'corr-1', data: { harnessSessionId: 'session-1' },
      }
      const second = {
        id: 'event-2', type: 'run.completed', runId: 'run-1', occurredAt: '2026-09-07T00:00:01.000Z',
        correlationId: 'corr-2',
      }
      return new Response([
        'retry: 5000\n\n',
        `id: event-1\nevent: planning\ndata: ${JSON.stringify(first)}\n\n`,
        ': keepalive\n\n',
        `id: event-2\nevent: run.completed\ndata: ${JSON.stringify(second)}\n\n`,
      ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (request.url.endsWith('/v1/harness/knowledge/search')) {
      return new Response(JSON.stringify({ items: [{ id: 'doc-1', title: 'Policy' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-server' },
      })
    }
    if (request.url.includes('/v1/harness/skills?')) {
      return new Response(JSON.stringify({ items: [{ id: 'ReviewSupplier' }], truncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (request.url.includes('/v1/harness/tasks?')) {
      return new Response(JSON.stringify({ items: [{ id: 'task-1', status: 'open' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (request.url.includes('/v1/harness/approvals?')) {
      return new Response(JSON.stringify({ items: [{ id: 'approval-1', status: 'pending' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (request.url.includes('/v1/harness/actions/Supplier.changeRisk/evaluate')) {
      return new Response(JSON.stringify({ allowed: true, reason: 'within envelope' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ status: 'executed', items: [{ id: 'order-1' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const client = new ObisBridgeClient({
    baseUrl: 'https://obis.test',
    tokenProvider: async () => 'access-token',
    fetch: fetchImpl,
    correlationIdProvider: () => 'corr-client',
  })
  return { client, seen }
}

describe('OBIS OHP bridge', () => {
  it('sends protocol, bearer, run and capability lease headers', async () => {
    const { client, seen } = mockClient()
    await client.executeQuery('production', 'FindOrders', { limit: 5 }, {
      agentRunId: 'run-1',
      capabilityLease: 'lease-1',
    })

    const request = seen[0]
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe('https://obis.test/v1/harness/queries/FindOrders/execute')
    expect(request?.headers.get('ohp-version')).toBe('1.0')
    expect(request?.headers.get('authorization')).toBe('Bearer access-token')
    expect(request?.headers.get('ohp-agent-run')).toBe('run-1')
    expect(request?.headers.get('ohp-capability-lease')).toBe('lease-1')
    expect(request?.headers.get('x-correlation-id')).toBe('corr-client')
  })

  it('normalizes collection envelopes from knowledge and skill endpoints', async () => {
    const { client } = mockClient()
    await expect(client.searchKnowledge('production', 'late orders')).resolves.toEqual([
      { id: 'doc-1', title: 'Policy' },
    ])
    await expect(client.listSkills('production')).resolves.toEqual([
      { id: 'ReviewSupplier' },
    ])
  })

  it('routes obis_get_object through a governed named query, never a raw object endpoint', async () => {
    const { client, seen } = mockClient()
    const tool = createObisTools(client).find(candidate => candidate.name === 'obis_get_object')
    if (!tool) throw new Error('obis_get_object was not registered')

    await tool.execute({ query: 'GetOrder', id: 'order-1' }, {
      environmentId: 'production',
      runId: 'run-1',
      capabilityLease: 'lease-1',
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://obis.test/v1/harness/queries/GetOrder/execute')
    expect(seen[0]?.url.includes('/objects/')).toBe(false)
    expect(seen[0]?.body).toEqual({ environmentId: 'production', id: 'order-1', limit: 1 })
  })

  it('streams normalized OHP events without exposing Harness SessionEvent', async () => {
    const { client, seen } = mockClient()
    const events = []
    for await (const event of client.streamAgentRunEvents('run-1', 'production', {
      afterId: 'event-0',
      capabilityLease: 'lease-1',
      agentRunId: 'run-1',
    })) events.push(event)

    expect(events.map(event => event.type)).toEqual(['planning', 'run.completed'])
    expect(events[0]?.data).toEqual({ harnessSessionId: 'session-1' })
    const request = seen[0]
    expect(request?.url).toContain('/v1/agent-runs/run-1/events?')
    expect(request?.url).toContain('environmentId=production')
    expect(request?.url).toContain('after=event-0')
    expect(request?.headers.get('accept')).toBe('text/event-stream')
    expect(request?.headers.get('ohp-capability-lease')).toBe('lease-1')
    expect(request?.headers.get('ohp-agent-run')).toBe('run-1')
  })

  it('covers OHP P0 evaluation, task list and approval decision without adding model tools', async () => {
    const { client, seen } = mockClient()
    await expect(client.evaluateAction('Supplier.changeRisk', {
      environmentId: 'production',
      runId: 'run-1',
      input: { risk: 'high' },
    }, { agentRunId: 'run-1', capabilityLease: 'lease-1' })).resolves.toEqual({
      allowed: true,
      reason: 'within envelope',
    })
    await expect(client.listTasks('production', { status: 'open', limit: 20 })).resolves.toEqual([
      { id: 'task-1', status: 'open' },
    ])
    await expect(client.listApprovals('production', { status: 'pending' })).resolves.toEqual([
      { id: 'approval-1', status: 'pending' },
    ])
    await client.decideApproval('approval-1', {
      environmentId: 'production',
      expectedVersion: 1,
      decision: 'approve',
    })

    expect(createObisTools(client).map(tool => tool.name)).not.toContain('obis_execute_action')
    expect(seen.some(request => request.url.endsWith('/v1/harness/actions/Supplier.changeRisk/evaluate'))).toBe(true)
    expect(seen.some(request => request.url.includes('/v1/harness/tasks?') && request.method === 'GET')).toBe(true)
    expect(seen.some(request => request.url.includes('/v1/harness/approvals?') && request.method === 'GET')).toBe(true)
    expect(seen.some(request =>
      request.url.endsWith('/v1/harness/approvals/approval-1/decisions') && request.method === 'POST',
    )).toBe(true)
  })

  it('stamps published module ids on AgentRun creation and bindObisRun', async () => {
    const { client, seen } = mockClient()
    await client.createAgentRun({
      environmentId: 'production',
      agentId: 'workspace',
      goal: 'Review supplier',
      projectId: 'procurement-project',
      applicationModuleId: 'supplier-risk',
    })
    expect(seen[0]?.body).toMatchObject({
      projectId: 'procurement-project',
      applicationModuleId: 'supplier-risk',
    })

    await expect(bindObisRun(client, {
      environmentId: 'production',
      agentId: 'workspace',
      goal: 'Review supplier',
      harnessSessionId: 'session-1',
      projectId: 'procurement-project',
    }, {})).rejects.toThrow(/projectId and applicationModuleId must be supplied together/)
    await expect(bindObisRun(client, {
      environmentId: 'production',
      agentId: 'workspace',
      goal: 'Review supplier',
      harnessSessionId: 'session-1',
      applicationModuleId: 'supplier-risk',
    }, {})).rejects.toThrow(/projectId and applicationModuleId must be supplied together/)

    await bindObisRun(client, {
      environmentId: 'production',
      agentId: 'workspace',
      goal: 'Review supplier',
      autonomy: 'human-approved',
      harnessSessionId: 'session-1',
      installationId: 'install-1',
      projectId: 'procurement-project',
      applicationModuleId: 'supplier-risk',
    }, { idempotencyKey: 'bind-1' })
    const created = seen.find(request => request.method === 'POST' && request.url.endsWith('/v1/agent-runs') && request.body && (request.body as { goal?: string }).goal === 'Review supplier' && (request.body as { autonomy?: string }).autonomy === 'human-approved')
    expect(created?.body).toMatchObject({
      projectId: 'procurement-project',
      applicationModuleId: 'supplier-risk',
      autonomy: 'human-approved',
    })
    expect(seen.some(request => request.url.endsWith('/v1/agent-runs/run-1/attach'))).toBe(true)
  })

  it('binds a workspace-wide AgentRun when no module ids are supplied', async () => {
    const { client, seen } = mockClient()
    await bindObisRun(client, {
      environmentId: 'production',
      agentId: 'workspace',
      goal: 'Workspace AI',
      harnessSessionId: 'session-2',
    }, {})
    expect(seen[0]?.body).toEqual({
      environmentId: 'production',
      agentId: 'workspace',
      goal: 'Workspace AI',
    })
  })
})
