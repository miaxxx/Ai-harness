import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import * as toolObis from '../src/index.ts'
import { serializeObisBusinessReference } from '@deepseek-ai/dsh-obis-bridge'

class TestCredentialProvider extends CredentialProvider {
  async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return { value: 'test-access-token', source: 'test' }
  }

  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: true, source: 'test', writable: false }
  }

  async set(): Promise<void> { throw new Error('read-only test credential provider') }
  async unset(): Promise<void> { throw new Error('read-only test credential provider') }
  async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> { return undefined }
  async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> { return { configured: false, writable: false } }
  async listRecords(): Promise<readonly CredentialRecordEntry[]> { return [] }
  async modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> { return undefined }
  async deleteRecord(): Promise<void> {}
}

type ToolCallId = Parameters<ToolRuntime['execute']>[0]['callId']

interface CapturedRequest {
  method: string
  url: URL
  headers: Headers
  body?: Record<string, unknown>
}

const lease = {
  id: 'lease-1',
  runId: 'run-1',
  deploymentId: 'dep-1',
  environmentId: 'prod',
  userId: 'user-1',
  deviceId: 'device-1',
  operations: ['context.read', 'query.execute', 'action.propose', 'proposal.execute', 'task.read'],
  issuedAt: '2026-09-07T00:00:00.000Z',
  expiresAt: '2026-09-08T00:00:00.000Z',
}

const run = {
  id: 'run-1',
  environmentId: 'prod',
  actorId: 'user-1',
  taskId: 'task-1',
  deploymentId: 'dep-1',
  artifactId: 'artifact-1',
  status: 'planning',
  version: 1,
  autonomy: 'human-approved',
  capabilityLease: lease,
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeAgent(id = 'session-1'): Agent {
  const events: Array<Record<string, unknown>> = [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'user/message',
      data: {
        id: 'message-1',
        role: 'user',
        content: [{ type: 'text', text: 'Approve the governed supplier change.' }],
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

function captureFetch(options: {
  approvalRun?: Record<string, unknown>
  executeResult?: Record<string, unknown>
  renewedLease?: Record<string, unknown>
  moduleBinding?: Record<string, unknown>
} = {}) {
  const requests: CapturedRequest[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const url = new URL(raw)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    let body: Record<string, unknown> | undefined
    if (typeof init?.body === 'string' && init.body.length > 0) body = JSON.parse(init.body) as Record<string, unknown>
    requests.push({ method: init?.method ?? (input instanceof Request ? input.method : 'GET'), url, headers, ...(body ? { body } : {}) })

    if (url.pathname === '/v1/agent-runs' && init?.method === 'POST') return response({ ...run, ...(options.moduleBinding ? { moduleBinding: options.moduleBinding } : {}) }, 201)
    if (url.pathname === '/v1/agent-runs/run-1/attach' && init?.method === 'POST') {
      return response({ ...run, harnessSessionId: 'session-1', capabilityLease: options.renewedLease && requests.filter(request => request.url.pathname.endsWith('/attach')).length > 1 ? options.renewedLease : lease })
    }
    if (url.pathname === '/v1/agent-runs/run-1' && (init?.method ?? 'GET') === 'GET') return response(run)
    if (url.pathname === '/v1/harness/context/resolve' && init?.method === 'POST') {
      return response({ deploymentId: 'dep-1', artifactId: 'artifact-1', symbols: [] })
    }
    if (url.pathname === '/v1/harness/skills/ReviewSupplier' && (init?.method ?? 'GET') === 'GET') {
      return response({ id: 'ReviewSupplier', description: 'Review supplier risk.' })
    }
    if (url.pathname === '/v1/harness/skills' && (init?.method ?? 'GET') === 'GET') {
      return response({ items: [{ id: 'ReviewSupplier' }], truncated: false })
    }
    if (url.pathname === '/v1/harness/tasks' && (init?.method ?? 'GET') === 'GET') {
      return response({ items: [{ id: 'task-1', status: 'open' }] })
    }
    if (url.pathname === '/v1/harness/approvals' && (init?.method ?? 'GET') === 'GET') {
      return response({ items: [{ id: 'approval-1', status: 'pending' }] })
    }
    if (url.pathname === '/v1/harness/actions/supplier.update/propose' && init?.method === 'POST') {
      return response({
        run: options.approvalRun ?? { ...run, version: 2 },
        proposal: {
          id: 'proposal-1',
          status: 'proposed',
          decision: { allowed: true, reason: 'Policy permits proposal creation.' },
        },
      })
    }
    if (url.pathname === '/v1/harness/proposals/proposal-1/execute' && init?.method === 'POST') {
      return response(options.executeResult ?? {
        run: { ...run, version: 3, status: 'completed' },
        proposal: { id: 'proposal-1', status: 'executed' },
        result: { status: 'executed', receiptId: 'receipt-1' },
      })
    }
    return response({ error: { code: 'UNEXPECTED_TEST_REQUEST', message: `${init?.method ?? 'GET'} ${url.pathname}`, correlationId: 'test', retryable: false } }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

async function mounted(options: { config?: Record<string, unknown> } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TestCredentialProvider)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(toolObis, {
    baseUrl: 'https://obis.example.test',
    environmentId: 'prod',
    credentialRef: 'OBIS_ACCESS_TOKEN',
    installationId: 'install-1',
    autonomy: 'human-approved',
    ...options.config,
  })
  return ctx
}

function attachLaunch(ctx: Context, launch: unknown): void {
  (ctx as unknown as { obisLaunch: unknown }).obisLaunch = launch
}

async function execute(ctx: Context, agent: Agent, callId: string, name: string, args: Record<string, unknown>) {
  return await ctx.tools.execute({
    callId: callId as ToolCallId,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  })
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-07T12:00:00Z')) })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OBIS governed workspace behavior', () => {
  it('binds a durable human-selected Module and attaches using the original Harness session', async () => {
    const { requests } = captureFetch({ moduleBinding: { projectId: 'p', moduleId: 'supplier-risk', version: '0.1.0' } })
    const ctx = await mounted({ config: { workspaceProjectId: 'p', referenceAutonomy: 'human-approved' } }), agent = fakeAgent()
    agent.session.append('user/message', { id: 'ref-1' as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: serializeObisBusinessReference({ kind: 'module', projectId: 'p', environmentId: 'prod', label: '供应商', moduleId: 'supplier-risk', moduleVersion: '0.1.0', pageId: 'home' }) }] }, { surfaceOp: 'append' })
    await execute(ctx, agent, 'module-read', 'obis_context', {})
    expect(requests.find(request => request.url.pathname === '/v1/agent-runs')?.body).toMatchObject({ projectId: 'p', applicationModuleId: 'supplier-risk', autonomy: 'human-approved' })
    expect(requests.find(request => request.url.pathname.endsWith('/attach'))?.body).toMatchObject({ harnessSessionId: 'session-1' })
  })

  it('rejects cross-workspace and changed-version references before a governed operation', async () => {
    const { requests } = captureFetch({ moduleBinding: { projectId: 'p', moduleId: 'supplier-risk', version: '0.2.0' } })
    const ctx = await mounted({ config: { workspaceProjectId: 'p' } }), agent = fakeAgent()
    const ref = { kind: 'module' as const, projectId: 'other', environmentId: 'prod', label: '供应商', moduleId: 'supplier-risk', moduleVersion: '0.1.0', pageId: 'home' }
    const add = (projectId: string) => agent.session.append('user/message', { id: 'ref-1' as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: serializeObisBusinessReference({ ...ref, projectId }) }] }, { surfaceOp: 'append' })
    add('other')
    const refused = await execute(ctx, agent, 'wrong-project', 'obis_context', {})
    expect(JSON.stringify(refused)).toContain('当前工作区')
    expect(requests).toHaveLength(0)
    add('p')
    const changed = await execute(ctx, agent, 'wrong-version', 'obis_context', {})
    expect(JSON.stringify(changed)).toContain('版本已变化')
    expect(requests.some(request => request.url.pathname === '/v1/harness/context/resolve')).toBe(false)
  })
  it('reattaches an expired lease to the same run once before concurrent tools', async () => {
    const renewedLease = { ...lease, id: 'lease-2', expiresAt: '2026-09-09T00:00:00Z' }
    const { requests } = captureFetch({ renewedLease })
    const ctx = await mounted(), agent = fakeAgent()
    await execute(ctx, agent, 'initial', 'obis_context', {})
    vi.setSystemTime(new Date(lease.expiresAt))
    await Promise.all([execute(ctx, agent, 'renewed-a', 'obis_context', {}), execute(ctx, agent, 'renewed-b', 'obis_context', {})])
    expect(requests.filter(request => request.url.pathname === '/v1/agent-runs')).toHaveLength(1)
    expect(requests.filter(request => request.url.pathname.endsWith('/attach'))).toHaveLength(2)
    expect(requests.filter(request => request.url.pathname === '/v1/harness/context/resolve').slice(1).map(request => request.headers.get('OHP-Capability-Lease'))).toEqual(['lease-2', 'lease-2'])
  })

  it('refuses an expired renewal before sending a governed operation', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted(), agent = fakeAgent()
    await execute(ctx, agent, 'initial', 'obis_context', {})
    vi.setSystemTime(new Date(lease.expiresAt))
    const result = await execute(ctx, agent, 'stale', 'obis_context', {})
    expect(JSON.stringify(result)).toContain('did not renew')
    expect(requests.filter(request => request.url.pathname === '/v1/harness/context/resolve')).toHaveLength(1)
  })

  it('binds one Harness Session to one AgentRun and reuses the returned capability lease', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted()
    const agent = fakeAgent()

    const first = await execute(ctx, agent, 'call-context', 'obis_context', {})
    const second = await execute(ctx, agent, 'call-context-2', 'obis_context', { maxSymbols: 12 })

    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(requests.filter(request => request.url.pathname === '/v1/agent-runs')).toHaveLength(1)
    expect(requests.filter(request => request.url.pathname === '/v1/agent-runs/run-1/attach')).toHaveLength(1)
    const governedReads = requests.filter(request => request.url.pathname === '/v1/harness/context/resolve')
    expect(governedReads).toHaveLength(2)
    for (const request of governedReads) {
      expect(request.headers.get('authorization')).toBe('Bearer test-access-token')
      expect(request.headers.get('ohp-capability-lease')).toBe('lease-1')
      expect(request.headers.get('ohp-agent-run')).toBe('run-1')
    }
    expect(requests.find(request => request.url.pathname === '/v1/agent-runs')?.body).toMatchObject({
      environmentId: 'prod',
      agentId: 'workspace',
      goal: 'Approve the governed supplier change.',
      autonomy: 'human-approved',
    })
    expect(requests.find(request => request.url.pathname === '/v1/agent-runs/run-1/attach')?.body).toMatchObject({
      harnessSessionId: 'session-1',
      installationId: 'install-1',
    })
  })

  it('lists entitled tasks, approvals, and skill ids through Kernel collection GET', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted()
    const agent = fakeAgent()
    const tasks = await execute(ctx, agent, 'call-tasks', 'obis_list_tasks', { status: 'open', limit: 20 })
    const approvals = await execute(ctx, agent, 'call-approvals', 'obis_list_approvals', { status: 'pending' })
    const skills = await execute(ctx, agent, 'call-skills', 'obis_list_skills', {})
    expect(tasks.isError).toBe(false)
    expect(approvals.isError).toBe(false)
    expect(skills.isError).toBe(false)
    if (tasks.isError || approvals.isError || skills.isError) throw new Error('inbox list tools failed')
    expect(tasks.value).toEqual([{ id: 'task-1', status: 'open' }])
    expect(approvals.value).toEqual([{ id: 'approval-1', status: 'pending' }])
    expect(skills.value).toEqual([{ id: 'ReviewSupplier' }])
    const taskList = requests.find(request => request.url.pathname === '/v1/harness/tasks')
    const approvalList = requests.find(request => request.url.pathname === '/v1/harness/approvals')
    const skillList = requests.find(request => request.url.pathname === '/v1/harness/skills')
    expect(taskList?.method).toBe('GET')
    expect(taskList?.url.searchParams.get('status')).toBe('open')
    expect(taskList?.url.searchParams.get('limit')).toBe('20')
    expect(approvalList?.method).toBe('GET')
    expect(approvalList?.url.searchParams.get('status')).toBe('pending')
    expect(skillList?.method).toBe('GET')
    for (const request of [taskList, approvalList, skillList]) {
      expect(request?.headers.get('ohp-capability-lease')).toBe('lease-1')
      expect(request?.headers.get('ohp-agent-run')).toBe('run-1')
    }
  })

  it('loads a deployment-pinned skill definition through the governed skill endpoint', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted()
    const result = await execute(ctx, fakeAgent(), 'call-skill', 'obis_get_skill', { skillId: 'ReviewSupplier' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toMatchObject({ id: 'ReviewSupplier', description: 'Review supplier risk.' })
    const skillRead = requests.find(request => request.url.pathname === '/v1/harness/skills/ReviewSupplier')
    expect(skillRead?.method).toBe('GET')
    expect(skillRead?.url.searchParams.get('environmentId')).toBe('prod')
    expect(skillRead?.headers.get('ohp-capability-lease')).toBe('lease-1')
    expect(skillRead?.headers.get('ohp-agent-run')).toBe('run-1')
  })

  it('stamps launch-bound project and module ids onto created AgentRuns', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted()
    attachLaunch(ctx, {
      snapshot: () => ({ projectId: 'procurement-project' }),
      applicationModuleId: () => 'supplier-risk',
    })
    await execute(ctx, fakeAgent(), 'call-launch-bind', 'obis_context', {})
    expect(requests.find(request => request.url.pathname === '/v1/agent-runs')?.body).toMatchObject({
      projectId: 'procurement-project',
      applicationModuleId: 'supplier-risk',
    })
  })

  it('prefers explicit config module ids over the launch Host snapshot', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted({
      config: { projectId: 'config-project', applicationModuleId: 'config-module' },
    })
    attachLaunch(ctx, {
      snapshot: () => ({ projectId: 'procurement-project' }),
      applicationModuleId: () => 'supplier-risk',
    })
    await execute(ctx, fakeAgent(), 'call-config-bind', 'obis_context', {})
    expect(requests.find(request => request.url.pathname === '/v1/agent-runs')?.body).toMatchObject({
      projectId: 'config-project',
      applicationModuleId: 'config-module',
    })
  })

  it('ignores incomplete launch snapshots and non-object launch services', async () => {
    const { requests } = captureFetch()
    const incomplete = await mounted()
    attachLaunch(incomplete, { snapshot: () => ({ projectId: 'procurement-project' }) })
    await execute(incomplete, fakeAgent('session-incomplete'), 'call-incomplete', 'obis_context', {})
    expect(requests.find(request => request.url.pathname === '/v1/agent-runs')?.body).not.toHaveProperty('projectId')

    const noSnapshot = await mounted()
    attachLaunch(noSnapshot, { applicationModuleId: () => 'supplier-risk' })
    await execute(noSnapshot, fakeAgent('session-no-snapshot'), 'call-no-snapshot', 'obis_context', {})

    const missing = await mounted()
    attachLaunch(missing, null)
    await execute(missing, fakeAgent('session-null'), 'call-null', 'obis_context', {})

    const primitive = await mounted()
    attachLaunch(primitive, 'not-a-service')
    await execute(primitive, fakeAgent('session-primitive'), 'call-primitive', 'obis_context', {})
    expect(requests.filter(request => request.url.pathname === '/v1/agent-runs')).toHaveLength(4)
    for (const request of requests.filter(item => item.url.pathname === '/v1/agent-runs')) {
      expect(request.body).not.toHaveProperty('applicationModuleId')
    }
  })


  it('asks the native approval seam and executes internally only after allowed-once', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted()
    const agent = fakeAgent()
    const approvals: string[] = []
    ctx.on('approval/request', (request) => {
      approvals.push(request.reason ?? '')
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    const result = await execute(ctx, agent, 'call-propose', 'obis_propose_action', {
      action: 'supplier.update',
      targetId: 'supplier-1',
      input: { status: 'approved' },
    })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toMatchObject({
      confirmation: { outcome: 'allowed-once' },
      execution: { result: { status: 'executed', receiptId: 'receipt-1' } },
    })
    expect(approvals).toEqual([expect.stringContaining('supplier.update')])
    const proposal = requests.find(request => request.url.pathname.endsWith('/actions/supplier.update/propose'))
    expect(proposal?.body).toMatchObject({ runId: 'run-1', expectedVersion: 1 })
    expect(proposal?.headers.get('idempotency-key')).toBe('tool:call-propose')
    expect(proposal?.headers.get('ohp-capability-lease')).toBe('lease-1')

    const execution = requests.find(request => request.url.pathname.endsWith('/proposals/proposal-1/execute'))
    expect(execution?.body).toMatchObject({ runId: 'run-1', expectedVersion: 2 })
    expect(execution?.headers.get('idempotency-key')).toBe('execute:call-propose:proposal-1')
    expect(execution?.headers.get('ohp-capability-lease')).toBe('lease-1')

    const approvalEvents = agent.session.events.filter(event => event.type.startsWith('approval/'))
    expect(approvalEvents.map(event => event.type)).toEqual(['approval/asked', 'approval/decided'])
    expect(approvalEvents[1]?.data).toMatchObject({ outcome: 'allowed-once' })
  })

  it('fails closed when the human rejects and never exposes an execute call to the model path', async () => {
    const { requests } = captureFetch()
    const ctx = await mounted()
    const agent = fakeAgent()
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))

    const result = await execute(ctx, agent, 'call-rejected', 'obis_propose_action', {
      action: 'supplier.update',
      input: { status: 'approved' },
    })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toMatchObject({
      confirmation: { outcome: 'rejected' },
      execution: { status: 'not-executed' },
    })
    expect(requests.some(request => request.url.pathname.includes('/proposals/proposal-1/execute'))).toBe(false)
    expect(ctx.tools.schemas(agent).some(schema => schema.name === 'obis_execute_action')).toBe(false)
  })
})
