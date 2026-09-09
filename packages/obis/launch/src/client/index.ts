/** Browser companion for secure OBIS Workspace handoff.
 * The fragment carries only a one-time ticket. It is removed from history before
 * the Host RPC runs; delegated credentials never enter browser storage or JS state.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'

export const inject = ['connection']

export interface SafeWorkspaceLaunchExchange {
  access: { sessionId: string; expiresAt: string }
  launch: {
    id: string
    tenantId: string
    userId: string
    environmentId: string
    harnessOrigin: string
    goal?: string
    autonomy: 'read-only' | 'recommend' | 'draft' | 'human-approved' | 'bounded-autonomous'
    createdAt: string
    expiresAt: string
    consumedAt?: string
  }
}

const SESSION_KEY = 'dsh.obisLaunch'

interface ObisLaunchRpcResult {
  ok: boolean
  value?: unknown
  error?: { message?: string }
}

interface ObisLaunchConnection {
  rpc: {
    call(path: string, method: string, input: unknown): Promise<ObisLaunchRpcResult>
  }
}

function consumeTicketFromFragment(): string | undefined {
  if (typeof location === 'undefined' || !location.hash) return undefined
  const params = new URLSearchParams(location.hash.slice(1))
  const ticket = params.get('obis-launch')?.trim() || undefined
  if (ticket === undefined) return undefined

  params.delete('obis-launch')
  // Older OBIS launchers briefly emitted obis-base. The Host owns baseUrl now,
  // so strip this legacy value rather than trusting it.
  params.delete('obis-base')
  const nextHash = params.toString()
  const next = `${location.pathname}${location.search}${nextHash ? `#${nextHash}` : ''}`
  history.replaceState(history.state, '', next)
  return ticket
}

function persistSafeLaunch(value: unknown): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
  } catch {
    // Safe metadata persistence is an optimization for UI continuity; failure
    // must not block the already-established Host credential handoff.
  }
}

/** Latest non-secret OBIS launch metadata saved by this browser tab. */
export function readObisLaunch(): SafeWorkspaceLaunchExchange | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return undefined
  try { return JSON.parse(raw) as SafeWorkspaceLaunchExchange } catch { return undefined }
}

export function apply(ctx: Context): void {
  const ticket = consumeTicketFromFragment()
  if (ticket === undefined || typeof location === 'undefined') return
  const harnessOrigin = location.origin

  const connection = ctx.connection as unknown as ObisLaunchConnection
  void connection.rpc.call('/obis-launch', 'exchange', { ticket, harnessOrigin }).then((result) => {
    if (!result.ok) throw new Error(result.error?.message ?? 'OBIS launch exchange failed')
    const exchange = result.value as SafeWorkspaceLaunchExchange
    persistSafeLaunch(exchange)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('obis:launch-ready', { detail: exchange }))
    }
  }).catch((error: unknown) => {
    console.error('[obis-launch] secure workspace handoff failed:', error)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('obis:launch-failed', {
        detail: { message: error instanceof Error ? error.message : String(error) },
      }))
    }
  })
}
