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

/** Kernel rejection or transport response failure with correlation and retry information. */
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

/** Kernel endpoint and Host credential provider; credentials are resolved for each request. */
export interface ObisBridgeClientOptions {
  baseUrl: string
  tokenProvider: () => Promise<string | undefined>
  fetch?: typeof globalThis.fetch
  correlationIdProvider?: () => string
}

/** Request tracing, cancellation and Kernel-issued authority attached to an OHP call. */
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

/** Authenticated OHP client. Kernel validates roles and leases; this client does not grant authority. */
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
      try {
        payload = JSON.parse(text) as unknown
      } catch {
        payload = {
          error: {
            code: 'OHP_INVALID_RESPONSE',
            message: text,
            correlationId: responseCorrelationId ?? '',
            retryable: false,
          },
        }
      }
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
      throw new ObisBridgeError(
        response.status,
        'OHP_REQUEST_FAILED',
        `OBIS request failed with ${response.status}.`,
        responseCorrelationId,
      )
    }
    return payload as T
  }

  /**
   * Reads supported OHP versions and Harness compatibility requirements.
   * @param signal Optional request cancellation signal.
   * @returns Kernel capability catalog.
   */
  capabilities(signal?: AbortSignal): Promise<OhpCapabilities> {
    return this.request('GET', '/v1/harness/capabilities', undefined, signal ? { signal } : {})
  }

  /**
   * Registers a device under the authenticated user and obtains compatibility results.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Registered installation and compatibility decision.
   */
  registerInstallation(
    input: HarnessRegistration,
    options: RequestOptions = {},
  ): Promise<{ installation: HarnessInstallation; compatibility: CompatibilityResult }> {
    return this.request('POST', '/v1/harness/installations', input, options)
  }

  /**
   * Updates an owned installation and reevaluates its version compatibility.
   * @param installationId Owned Harness installation identifier.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Updated installation and compatibility decision.
   */
  heartbeat(
    installationId: string,
    input: Partial<Pick<
      HarnessRegistration,
      'harnessVersion' | 'bridgeVersion' | 'protocolVersions' | 'capabilities'
    >>,
    options: RequestOptions = {},
  ): Promise<{ installation: HarnessInstallation; compatibility: CompatibilityResult }> {
    return this.request(
      'POST',
      `/v1/harness/installations/${encodeURIComponent(installationId)}/heartbeat`,
      input,
      options,
    )
  }

  /**
   * Resolves policy-visible enterprise definitions in the requested environment.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Governed context response.
   */
  resolveContext(
    environmentId: string,
    input: { focus?: JsonRecord; maxSymbols?: number } = {},
    options: RequestOptions = {},
  ): Promise<JsonRecord> {
    return this.request('POST', '/v1/harness/context/resolve', { environmentId, ...input }, options)
  }

  /**
   * Checks a Query against Kernel policy without returning executed Query rows.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param query Declared Query name or knowledge search text.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Kernel Query evaluation.
   */
  evaluateQuery(
    environmentId: string,
    query: string,
    input: { id?: string; where?: JsonRecord; limit?: number; context?: JsonRecord } = {},
    options: RequestOptions = {},
  ): Promise<JsonRecord> {
    return this.request(
      'POST',
      `/v1/harness/queries/${encodeURIComponent(query)}/evaluate`,
      { environmentId, ...input },
      options,
    )
  }

  /**
   * Reads Query rows after Kernel policy and run authority validation.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param query Declared Query name or knowledge search text.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Kernel-filtered Query response.
   */
  executeQuery(
    environmentId: string,
    query: string,
    input: { id?: string; where?: JsonRecord; limit?: number; context?: JsonRecord } = {},
    options: RequestOptions = {},
  ): Promise<JsonRecord> {
    return this.request(
      'POST',
      `/v1/harness/queries/${encodeURIComponent(query)}/execute`,
      { environmentId, ...input },
      options,
    )
  }

  /**
   * Searches enterprise knowledge visible to the authenticated principal.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param query Declared Query name or knowledge search text.
   * @param limit Maximum knowledge matches requested.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Visible knowledge matches.
   */
  async searchKnowledge(
    environmentId: string,
    query: string,
    limit = 20,
    options: RequestOptions = {},
  ): Promise<JsonRecord[]> {
    const result = await this.request<{ items: JsonRecord[] }>(
      'POST',
      '/v1/harness/knowledge/search',
      { environmentId, query, limit },
      options,
    )
    return result.items
  }

  /**
   * Creates or idempotently retrieves a Kernel run bound to its deployment.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Durable run binding and granted lease, when available.
   */
  createAgentRun(
    input: {
      environmentId: string
      agentId: string
      goal: string
      autonomy?: string
      projectId?: string
      applicationModuleId?: string
    },
    options: RequestOptions = {},
  ): Promise<AgentRunBinding> {
    return this.request('POST', '/v1/agent-runs', input, options)
  }

  /**
   * Attaches a Harness Session to an existing run after ownership validation.
   * @param runId Owned Kernel AgentRun identifier.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Attached run binding.
   */
  attachAgentRun(
    runId: string,
    input: { environmentId: string; harnessSessionId: string; installationId?: string },
    options: RequestOptions = {},
  ): Promise<AgentRunBinding> {
    return this.request('POST', `/v1/agent-runs/${encodeURIComponent(runId)}/attach`, input, options)
  }

  /**
   * Reads an owned run in its authenticated environment.
   * @param runId Owned Kernel AgentRun identifier.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Current durable run binding.
   */
  getAgentRun(runId: string, environmentId: string, options: RequestOptions = {}): Promise<AgentRunBinding> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/agent-runs/${encodeURIComponent(runId)}?${params}`, undefined, options)
  }

  /**
   * Evaluates policy and approval requirements without executing an Action.
   * @param action Declared Kernel Action name.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Kernel Action evaluation.
   */
  evaluateAction(
    action: string,
    input: {
      environmentId: string
      runId: string
      input: JsonRecord
      targetId?: string
      expectedObjectVersion?: number
    },
    options: RequestOptions = {},
  ): Promise<JsonRecord> {
    return this.request(
      'POST',
      `/v1/harness/actions/${encodeURIComponent(action)}/evaluate`,
      input,
      options,
    )
  }

  /**
   * Stores a run-scoped Action proposal using the expected run version.
   * @param action Declared Kernel Action name.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Durable proposal response.
   */
  proposeAction(
    action: string,
    input: {
      environmentId: string
      runId: string
      expectedVersion: number
      targetId?: string
      expectedObjectVersion?: number
      input: JsonRecord
    },
    options: RequestOptions = {},
  ): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/actions/${encodeURIComponent(action)}/propose`, input, options)
  }

  /**
   * Requests execution of a confirmed proposal; Kernel rechecks policy and approval. This method is absent from the model tool registry.
   * @param proposalId Confirmed run-scoped proposal identifier.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Kernel execution or approval-required response.
   */
  executeProposal(
    proposalId: string,
    input: { environmentId: string; runId: string; expectedVersion: number },
    options: RequestOptions = {},
  ): Promise<JsonRecord> {
    return this.request('POST', `/v1/harness/proposals/${encodeURIComponent(proposalId)}/execute`, input, options)
  }

  /**
   * Reads one task visible to the authenticated principal.
   * @param taskId Visible task identifier.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Visible task state.
   */
  getTask(taskId: string, environmentId: string, options: RequestOptions = {}): Promise<JsonRecord> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/harness/tasks/${encodeURIComponent(taskId)}?${params}`, undefined, options)
  }

  /**
   * Lists tasks after Kernel visibility filtering.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Visible tasks matching the requested filters.
   */
  async listTasks(
    environmentId: string,
    input: { status?: string; limit?: number } = {},
    options: RequestOptions = {},
  ): Promise<JsonRecord[]> {
    const params = new URLSearchParams({ environmentId })
    if (input.status) params.set('status', input.status)
    if (input.limit !== undefined) params.set('limit', String(input.limit))
    const result = await this.request<{ items: JsonRecord[] }>(
      'GET',
      `/v1/harness/tasks?${params}`,
      undefined,
      options,
    )
    return result.items
  }

  /**
   * Lists the principal's visible approval inbox without deciding approvals.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Visible approval requests.
   */
  async listApprovals(
    environmentId: string,
    input: { status?: string } = {},
    options: RequestOptions = {},
  ): Promise<JsonRecord[]> {
    const params = new URLSearchParams({ environmentId })
    if (input.status) params.set('status', input.status)
    const result = await this.request<{ items: JsonRecord[] }>(
      'GET',
      `/v1/harness/approvals?${params}`,
      undefined,
      options,
    )
    return result.items
  }

  /**
   * Records a human approval decision using an expected approval version. This method is absent from the model tool registry.
   * @param approvalId Approval request visible to the human principal.
   * @param input Operation fields validated by Kernel.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Updated approval request.
   */
  decideApproval(
    approvalId: string,
    input: {
      environmentId: string
      expectedVersion: number
      decision: 'approve' | 'reject'
      comment?: string
    },
    options: RequestOptions = {},
  ): Promise<JsonRecord> {
    return this.request(
      'POST',
      `/v1/harness/approvals/${encodeURIComponent(approvalId)}/decisions`,
      input,
      options,
    )
  }

  /**
   * Lists visible skill definitions without starting skill execution.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Visible skill catalog.
   */
  async listSkills(environmentId: string, options: RequestOptions = {}): Promise<JsonRecord[]> {
    const params = new URLSearchParams({ environmentId })
    const result = await this.request<{ items: JsonRecord[] }>(
      'GET',
      `/v1/harness/skills?${params}`,
      undefined,
      options,
    )
    return result.items
  }

  /**
   * Reads a visible skill definition without invoking its runtime.
   * @param skillId Visible skill identifier.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns Visible skill definition.
   */
  getSkill(skillId: string, environmentId: string, options: RequestOptions = {}): Promise<JsonRecord> {
    const params = new URLSearchParams({ environmentId })
    return this.request('GET', `/v1/harness/skills/${encodeURIComponent(skillId)}?${params}`, undefined, options)
  }

  /**
   * Streams validated run events over SSE until the stream closes or is aborted.
   * @param runId Owned Kernel AgentRun identifier.
   * @param environmentId Environment belonging to the authenticated tenant.
   * @param options Tracing, cancellation and Kernel-issued request authority.
   * @returns An async iterator of Kernel run events.
   */
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
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/agent-runs/${encodeURIComponent(runId)}/events?${params}`,
      {
        method: 'GET',
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    )
    if (!response.ok) {
      const responseCorrelationId = response.headers.get('x-correlation-id') ?? undefined
      const text = await response.text()
      let payload: unknown
      try {
        payload = text ? JSON.parse(text) as unknown : undefined
      } catch {
        payload = undefined
      }
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
      throw new ObisBridgeError(
        response.status,
        'OHP_REQUEST_FAILED',
        `OBIS event stream failed with ${response.status}.`,
        responseCorrelationId,
      )
    }
    if (!response.body) {
      throw new ObisBridgeError(502, 'OHP_INVALID_RESPONSE', 'OBIS event stream returned no body.')
    }

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
            try {
              parsed = JSON.parse(data) as unknown
            } catch {
              throw new ObisBridgeError(
                502,
                'OHP_INVALID_RESPONSE',
                'OBIS event stream returned invalid JSON event data.',
              )
            }
            const event = parseOhpEvent(parsed)
            if (!event) {
              throw new ObisBridgeError(
                502,
                'OHP_INVALID_RESPONSE',
                'OBIS event stream returned an invalid OHP event.',
              )
            }
            yield event
          }
          boundary = buffer.indexOf('\n\n')
        }
        if (done) break
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // Stream may already be aborted by the caller.
      }
      reader.releaseLock()
    }
  }
}
