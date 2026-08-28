/**
 * Product-side ACP stdio transport for the dsh CLI.
 *
 * This module is intentionally client-only: it may spawn a Runtime process and
 * speak ACP, but it must never import Agent, Session, Tool Registry, or Sandbox
 * internals. The Runtime command is deployment-owned and replaceable.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent as AcpAgent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'

export interface AcpRuntimeSpec {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface AcpClientHandlers {
  onSessionUpdate: (notification: SessionNotification) => void | Promise<void>
  onPermissionRequest?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
}

export interface AcpRuntimeConnection {
  client: ClientSideConnection
  /** Ends ACP input and proves the child Runtime process has exited. */
  dispose(): Promise<void>
}

function rejectPermission(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } }
}

async function waitForExit(child: ChildProcess, graceMs = 3_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit').then(() => true)
  const timeout = new Promise<false>(resolve => {
    const timer = setTimeout(() => resolve(false), graceMs)
    timer.unref()
  })
  if (await Promise.race([exited, timeout])) return
  child.kill('SIGTERM')
  if (child.exitCode !== null || child.signalCode !== null) return
  const killed = once(child, 'exit').then(() => true)
  const killTimeout = new Promise<false>(resolve => {
    const timer = setTimeout(() => resolve(false), graceMs)
    timer.unref()
  })
  if (await Promise.race([killed, killTimeout])) return
  child.kill('SIGKILL')
  await once(child, 'exit').catch(() => {})
}

/**
 * Spawn one replaceable ACP Runtime process and return the product-side
 * connection. Diagnostics inherit stderr; stdout is reserved for ACP framing.
 */
export async function connectAcpRuntime(
  spec: AcpRuntimeSpec,
  handlers: AcpClientHandlers,
): Promise<AcpRuntimeConnection> {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  const spawnError = once(child, 'error').then(([error]) => {
    throw error instanceof Error ? error : new Error(String(error))
  })

  const makeClient = (_agent: AcpAgent): Client => ({
    sessionUpdate(notification: SessionNotification): Promise<void> {
      return Promise.resolve(handlers.onSessionUpdate(notification))
    },
    requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      return handlers.onPermissionRequest?.(request) ?? Promise.resolve(rejectPermission())
    },
  })

  const client = new ClientSideConnection(
    makeClient,
    ndJsonStream(
      NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  )

  try {
    await Promise.race([
      client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
      spawnError,
    ])
  } catch (error: unknown) {
    child.stdin.end()
    await waitForExit(child)
    throw error
  }

  let disposed: Promise<void> | undefined
  return {
    client,
    dispose(): Promise<void> {
      return disposed ??= (async () => {
        child.stdin.end()
        await waitForExit(child)
      })()
    },
  }
}