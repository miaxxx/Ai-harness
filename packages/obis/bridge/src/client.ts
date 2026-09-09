import type {
  AgentRunBinding,
  CompatibilityResult,
  HarnessInstallation,
  HarnessRegistration,
  JsonRecord,
  OhpCapabilities,
  OhpErrorBody,
  OhpRunEvent,
} from './types.ts'

export class ObisBridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId?: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ObisBridgeError'
  }
}

export interface ObisBridgeClientOptions {
  baseUrl: string
  tokenProvider: () => Promise<string | undefined>
  fetch?: typeof globalThis.fetch
  correlationIdProvider?: () => string
}

export interface RequestOptions {
  idempotencyKey?: string
  correlationId?: string
  capabilityLease?: string
  agentRunId?: string
  signal?: AbortSignal
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function isOhpError(value: unknown): value is OhpErrorBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const error = (value as Record<string, unknown>).error
  return !!error && typeof error === 'object' && !Array.isArray(error)
    && typeof (error as Record<string, unknown>).message === 'string'
}

function parseOhpEvent(value: unknown): OhpRunEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.type !== 'string' || typeof record.runId !== 'string'
    || typeof record.occurredAt !== 'string' || typeof record.correlationId !== 'string') return undefined
  return value as OhpRunEvent
}

function eventData(frame: string): string | undefined {
  const lines = frame.split('\n')
  const values = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /, ''))
  return values.length ? values.join('\n') : undefined
}

export class ObisBridgeClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(private readonly options: ObisBridgeClientOptions) {
    this.baseUrl = stripTrailingSlash(options.baseUrl)
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (!this.baseUrl) throw new TypeError('OBIS baseUrl is required.')
  }

  private async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const token = await this.options.tokenProvider()
    const headers = new Headers({ Accept: 'application/json', 'OHP-Version': '1.0' })
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const correlationId = options.correlationId ?? this.options.correlationIdProvider?.()
    if (correlationId) headers.set('X-Correlation-Id', correlationId)
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
    if (options.capabilityLease) headers.set('OHP-Capability-Lease', options.capabilityLease)
    if (options.agentRunId) headers.set('OHP-Agent-Run', options.agentRunId)
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const responseCorrelationId = response.headers.get('x-correlation-id') ?? undefined
    const text = await response.text()
    let payload: unknown
    if (text) {
      try { payload = JSON.parse(text) as unknown }
      catch { payload = { error: { code: 'OHP_INVALID_RESPONSE', message: text, correlationId: responseCorrelationId ?? '', retryable: false } } }
    }
    if (!response.ok) {
      if (isOhpError(payload)) {
        throw new ObisBridgeError(
          response.status,
          payload.error.code,
          payload.error.message,
          payload.error.correlationId || responseCorrelationId,

          payload.error.retryable,
          payload.error.details,
        )
      }
      throw new ObisBridgeError(response.status, 'OHP_REQUEST_FAILED', `OBIS request failed with ${response.status}.`, responseCorrelationId)
    }
    return payload as T
  }

  capabilities(signal?: AbortSignal): Promise<OhpCapabilities> {
    return this.request('GET', '/v1/harness/capabilities', undefined, signal ? { signal } : {})
  }

  registerInstallation(input: HarnessRegistration, options: RequestOptions = {}): Promise<{ installation: HarnessInstallation; compatibility: CompatibilityResult }> {
    return this.request('POST', '/v1/harness/installations', input, options)
  }

  heartbeat(installationId: string, input: Partial<Pick<HarnessRegistration, 'harnessVersion' | 'bridgeVersion' | 'protocolVersions' | 'capabilities'>>, options: RequestOptions = {}): Promise<{ installation: HarnessInstallation; compatibility: CompatibilityResult }> {
    return this.request('POST', `/v1/harness/installations/${encodeURIComponent(installationId)}/heartbeat`, input, options)
  }

  resolveContext(environmentId: string, input: { focus?: JsonRecord; maxSymbols?: number } = {}, options: RequestOptions = {}): Promise<JsonRecord> {
    return this.request('POST', '/v1/harness/context/resolve', { environmentId, ...input }, options)
  }

  evaluateQuery(environmentId: string, query: string, input: { id?: string; where?: JsonRecord; limit?: number; context?: JsonRecord } = {}, options: RequestOptions = {}): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/queries/${encodeURIComponent(query)}/evaluate`, { environmentId, ...input }, options)
  }

  executeQuery(environmentId: string, query: string, input: { id?: string; where?: JsonRecord; limit?: number; context?: JsonRecord } = {}, options: RequestOptions = {}): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/queries/${encodeURIComponent(query)}/execute`, { environmentId, ...input }, options)
  }

  async searchKnowledge(environmentId: string, query: string, limit = 20, options: RequestOptions = {}): Promise<JsonRecord[]> {
    const result = await this.request<{ items: JsonRecord[] }>('POST', '/v1/harness/knowledge/search', { environmentId, query, limit }, options)
    return result.items
  }

  createAgentRun(input: { environmentId: string; agentId: string; goal: string; autonomy?: string }, options: RequestOptions = {}): Promise<AgentRunBinding> {
    return this.request('POST', '/v1/agent-runs', input, options)
  }

  attachAgentRun(runId: string, input: { environmentId: string; harnessSessionId: string; installationId?: string }, options: RequestOptions = {}): Promise<AgentRunBinding> {
    return this.request('POST', `/v1/agent-runs/${encodeURIComponent(runId)}/attach`, input, options)
  }

  getAgentRun(runId: string, environmentId: string, options: RequestOptions = {}): Promise<AgentRunBinding> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/agent-runs/${encodeURIComponent(runId)}?${params}`, undefined, options)
  }

  proposeAction(action: string, input: { environmentId: string; runId: string; expectedVersion: number; targetId?: string; expectedObjectVersion?: number; input: JsonRecord }, options: RequestOptions = {}): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/actions/${encodeURIComponent(action)}/propose`, input, options)
  }

  executeProposal(proposalId: string, input: { environmentId: string; runId: string; expectedVersion: number }, options: RequestOptions = {}): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/proposals/${encodeURIComponent(proposalId)}/execute`, input, options)
  }

  getTask(taskId: string, environmentId: string, options: RequestOptions = {}): Promise<JsonRecord> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/harness/tasks/${encodeURIComponent(taskId)}?${params}`, undefined, options)
  }

  async listSkills(environmentId: string, options: RequestOptions = {}): Promise<JsonRecord[]> {
    const params = new URLSearchParams({ environmentId })
    const result = await this.request<{ items: JsonRecord[] }>('GET', `/v1/harness/skills?${params}`, undefined, options)
    return result.items
  }

  getSkill(skillId: string, environmentId: string, options: RequestOptions = {}): Promise<JsonRecord> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/harness/skills/${encodeURIComponent(skillId)}?${params}`, undefined, options)
  }

  async *streamAgentRunEvents(
    runId: string,
    environmentId: string,
    options: RequestOptions & { afterId?: string } = {},
  ): AsyncGenerator<OhpRunEvent, void, void> {
    const token = await this.options.tokenProvider()
    const params = new URLSearchParams({ environmentId })
    if (options.afterId) params.set('after', options.afterId)
    const headers = new Headers({ Accept: 'text/event-stream', 'OHP-Version': '1.0' })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const correlationId = options.correlationId ?? this.options.correlationIdProvider?.()
    if (correlationId) headers.set('X-Correlation-Id', correlationId)
    if (options.capabilityLease) headers.set('OHP-Capability-Lease', options.capabilityLease)
    headers.set('OHP-Agent-Run', options.agentRunId ?? runId)
    const response = await this.fetchImpl(`${this.baseUrl}/v1/agent-runs/${encodeURIComponent(runId)}/events?${params}`, {
      method: 'GET', headers, ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!response.ok) {
      const responseCorrelationId = response.headers.get('x-correlation-id') ?? undefined
      const text = await response.text()
      let payload: unknown
      try { payload = text ? JSON.parse(text) as unknown : undefined }
      catch { payload = undefined }
      if (isOhpError(payload)) {
        throw new ObisBridgeError(
          response.status,
          payload.error.code,
          payload.error.message,
          payload.error.correlationId || responseCorrelationId,

          payload.error.retryable,
          payload.error.details,
        )
      }
      throw new ObisBridgeError(response.status, 'OHP_REQUEST_FAILED', `OBIS event stream failed with ${response.status}.`, responseCorrelationId)
    }
    if (!response.body) throw new ObisBridgeError(502, 'OHP_INVALID_RESPONSE', 'OBIS event stream returned no body.')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = eventData(frame)
          if (data) {
            let parsed: unknown
            try { parsed = JSON.parse(data) as unknown }
            catch { throw new ObisBridgeError(502, 'OHP_INVALID_RESPONSE', 'OBIS event stream returned invalid JSON event data.') }
            const event = parseOhpEvent(parsed)
            if (!event) throw new ObisBridgeError(502, 'OHP_INVALID_RESPONSE', 'OBIS event stream returned an invalid OHP event.')
            yield event
          }
          boundary = buffer.indexOf('\n\n')
        }
        if (done) break
      }
    } finally {
      try { await reader.cancel() } catch { /* stream may already be aborted by the caller */ }
      reader.releaseLock()
    }
  }
}
