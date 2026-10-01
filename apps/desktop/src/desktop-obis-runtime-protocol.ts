/** Host-only exchange of a validated workspace ticket for a short-lived runtime credential. */
import type { DesktopEnterpriseRuntimeScope } from './desktop-enterprise-runtime-shared.ts'
import { obisJsonRequest } from './desktop-obis-identity-protocol.ts'

/** Private native identity inputs; these are never sent to the renderer. */
export interface DesktopRuntimeDelegationInput {
  baseURL: string
  accessToken: string
  deviceId: string
  harnessOrigin: string
  scope: DesktopEnterpriseRuntimeScope
  autonomy?: 'read-only' | 'human-approved'
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function requireScope(value: unknown, scope: DesktopEnterpriseRuntimeScope, autonomy: 'read-only' | 'human-approved'): void {
  const launch = record(value)
  if (launch?.tenantId !== scope.tenantId || launch.projectId !== scope.projectId
    || launch.environmentId !== scope.environmentId || launch.userId !== scope.userId
    || launch.autonomy !== autonomy) throw new Error('OBIS 返回的启动作用域与当前用户不一致。')
}

/**
 * Consume a server-issued ticket in the native Host, retaining only delegated access.
 * @param input Authenticated identity and server-validated workspace scope.
 * @param fetchImpl HTTP transport used for issuance and one-time exchange.
 * @returns Delegated credential and server expiry for the supervised runtime.
 */
export async function issueDesktopRuntimeDelegation(
  input: DesktopRuntimeDelegationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: string }> {
  const origin = new URL(input.harnessOrigin)
  const autonomy = input.autonomy ?? 'read-only'
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('企业启动入口必须是可信 HTTPS 源。')
  }
  const issued = await obisJsonRequest<unknown>(input.baseURL, '/v1/workspace-launches', {
    method: 'POST', accessToken: input.accessToken, ohp: true,
    body: { projectId: input.scope.projectId, environmentId: input.scope.environmentId,
      harnessOrigin: origin.origin, autonomy },
  }, fetchImpl)
  const ticket = record(issued.value)
  requireScope(ticket?.launch, input.scope, autonomy)
  if (typeof ticket?.ticket !== 'string' || !ticket.ticket) throw new Error('OBIS 未返回有效启动票据。')
  const exchanged = await obisJsonRequest<unknown>(input.baseURL, '/v1/workspace-launches/exchange', {
    method: 'POST', ohp: true,
    body: { ticket: ticket.ticket, harnessOrigin: origin.origin, deviceId: input.deviceId },
  }, fetchImpl)
  const envelope = record(exchanged.value)
  requireScope(envelope?.launch, input.scope, autonomy)
  const access = record(envelope?.access)
  if (typeof access?.accessToken !== 'string' || !access.accessToken || typeof access.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= Date.now()) {
    throw new Error('OBIS 未返回有效委托凭证。')
  }
  return { accessToken: access.accessToken, expiresAt: access.expiresAt }
}
