import type {
  AgentRunBinding,
  CompatibilityResult,
  HarnessInstallation,
  HarnessRegistration,
  JsonRecord,
  OhpCapabilities,
  OhpErrorBody,
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

export class ObisBridgeClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(private readonly options: ObisBridgeClientOptions) {
    this.baseUrl = stripTrailingSlash(options.baseUrl)
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (!this.baseUrl) throw new TypeError('OBIS baseUrl is required.')
    if (!this.fetchImpl) throw new TypeError('A Fetch implementation is required.')
  }

  private async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const token = await this.options.tokenProvider()
    const headers = new Headers({ Accept: 'application/json', 'OHP-Version': '1.0' })
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const correlationId = options.correlationId ?? this.options.correlationIdProvider?.()
    if (correlationId) headers.set('X-Correlation-Id', correlationId)
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
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
          String(payload.error.code ?? 'OHP_REQUEST_FAILED'),
          payload.error.message,
          payload.error.correlationId || responseCorrelationId,
          payload.error.retryable === true,
          payload.error.details,
        )
      }
      throw new ObisBridgeError(response.status, 'OHP_REQUEST_FAILED', `OBIS request failed with ${response.status}.`, responseCorrelationId)
    }
    return payload as T
  }

  capabilities(signal?: AbortSignal): Promise<OhpCapabilities> {
    return this.request('GET', '/v1/harness/capabilities', undefined, { signal })
  }

  registerInstallation(input: HarnessRegistration, options?: RequestOptions): Promise<{ installation: HarnessInstallation; compatibility: CompatibilityResult }> {
    return this.request('POST', '/v1/harness/installations', input, undefined, options)
  }

  heartbeat(installationId: string, input: Partial<Pick<HarnessRegistration, 'harnessVersion' | 'bridgeVersion' | 'protocolVersions' | 'capabilities'>>, options?: RequestOptions): Promise<{ installation: HarnessInstallation; compatibility: CompatibilityResult }> {
    return this.request('POST', `/v1/harness/installations/${encodeURIComponent(installationId)}/heartbeat`, input, undefined, options)
  }

  resolveContext(environmentId: string, input: { focus?: JsonRecord; maxSymbols?: number } = {}, options?: RequestOptions): Promise<JsonRecord> {
    return this.request('POST', '/v1/harness/context/resolve', { environmentId, ...input }, undefined, options)
  }

  evaluateQuery(environmentId: string, query: string, input: { id?: string; where?: JsonRecord; limit?: number; context?: JsonRecord } = {}, options?: RequestOptions): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/queries/${encodeURIComponent(query)}/evaluate`, { environmentId, ...input }, undefined, options)
  }

  executeQuery(environmentId: string, query: string, input: { id?: string; where?: JsonRecord; limit?: number; context?: JsonRecord } = {}, options?: RequestOptions): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/queries/${encodeURIComponent(query)}/execute`, { environmentId, ...input }, undefined, options)
  }

  searchKnowledge(environmentId: string, query: string, limit = 20, options?: RequestOptions): Promise<JsonRecord[]> {
    return this.request('POST', '/v1/harness/knowledge/search', { environmentId, query, limit }, undefined, options)
  }

  createAgentRun(input: { environmentId: string; agentId: string; goal: string; autonomy?: string; taskId?: string }, options: RequestOptions): Promise<AgentRunBinding> {
    return this.request('POST', '/v1/agent-runs', input, undefined, options)
  }

  attachAgentRun(runId: string, input: { environmentId: string; harnessSessionId: string; installationId?: string }, options: RequestOptions): Promise<AgentRunBinding> {
    return this.request('POST', `/v1/agent-runs/${encodeURIComponent(runId)}/attach`, input, undefined, options)
  }

  getAgentRun(runId: string, environmentId: string, options?: RequestOptions): Promise<AgentRunBinding> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/agent-runs/${encodeURIComponent(runId)}?${params}`, undefined, options)
  }

  proposeAction(action: string, input: { environmentId: string; runId: string; expectedVersion: number; targetId?: string; expectedObjectVersion?: number; input: JsonRecord }, options: RequestOptions): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/actions/${encodeURIComponent(action)}/propose`, input, undefined, options)
  }

  getTask(taskId: string, environmentId: string, options?: RequestOptions): Promise<JsonRecord> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/harness/tasks/${encodeURIComponent(taskId)}?${params}`, undefined, options)
  }

  listSkills(environmentId: string, options?: RequestOptions): Promise<JsonRecord[]> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/harness/skills?${params}`, undefined, options)
  }

  getSkill(skillId: string, environmentId: string, options?: RequestOptions): Promise<JsonRecord> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/harness/skills/${encodeURIComponent(skillId)}?${params}`, undefined, options)
  }
}
