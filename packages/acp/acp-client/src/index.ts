/**
 * Product-side ACP subprocess transport shared by CLI, IDE, and Desktop.
 *
 * The client owns only process lifetime and the ACP wire. The spawned Runtime
 * owns Agent, Session, tools, permission policy, persistence, and sandboxing.
 * @module @deepseek-ai/dsh-acp-client
 */

import { spawn, type ChildProcess } from 'node:child_process'
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

const DISPOSE_EOF_GRACE_MS = 6_000
const DISPOSE_SIGNAL_GRACE_MS = 3_000

/** A replaceable ACP Runtime process selected by the product host. */
export interface AcpRuntimeSpec {
  /** Runtime executable. */
  command: string
  /** Arguments passed to the Runtime executable. */
  args: string[]
  /** Runtime process working directory. */
  cwd: string
  /** Explicit environment additions layered over the product process environment. */
  env?: Record<string, string>
}

/** Product-owned callbacks for wire updates and human permission decisions. */
export interface AcpClientHandlers {
  /** Receive every ACP session update without changing its wire meaning. */
  onSessionUpdate: (notification: SessionNotification) => void | Promise<void>
  /** Resolve a Runtime permission request. Omission is fail-closed. */
  onPermissionRequest?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  /** Receive Runtime diagnostics; omission inherits the product process stderr. */
  onRuntimeStderr?: (text: string) => void
}

/** One initialized ACP connection and its owned Runtime subprocess. */
export interface AcpRuntimeConnection {
  /** Standard ACP SDK connection; product code calls ACP methods directly. */
  client: ClientSideConnection
  /** Close the wire and prove the Runtime process has exited. */
  dispose(): Promise<void>
}

function rejectPermission(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } }
}

function exitsWithin(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, ms).unref()
    child.once('exit', onExit)
  })
}

async function forceTerminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  if (await exitsWithin(child, DISPOSE_SIGNAL_GRACE_MS)) return
  throw new Error(`ACP Runtime did not exit within ${DISPOSE_SIGNAL_GRACE_MS}ms after SIGKILL`)
}

async function disposeProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.stdin?.end()
  if (await exitsWithin(child, DISPOSE_EOF_GRACE_MS)) return
  if (process.platform !== 'win32') {
    child.kill('SIGTERM')
    if (await exitsWithin(child, DISPOSE_SIGNAL_GRACE_MS)) return
  }
  await forceTerminate(child)
}

/**
 * Spawn and initialize one ACP Runtime process.
 * @param spec - Executable, arguments, cwd, and explicit environment additions.
 * @param handlers - Product callbacks for updates, permissions, and diagnostics.
 * @returns An initialized standard ACP connection with quiescent disposal.
 */
export async function connectAcpRuntime(
  spec: AcpRuntimeSpec,
  handlers: AcpClientHandlers,
): Promise<AcpRuntimeConnection> {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', handlers.onRuntimeStderr === undefined ? 'inherit' : 'pipe'],
  })
  if (child.stdin === null || child.stdout === null) {
    child.kill('SIGKILL')
    throw new Error('ACP Runtime process did not expose piped protocol streams')
  }
  if (handlers.onRuntimeStderr !== undefined && child.stderr !== null) {
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text: string) => { handlers.onRuntimeStderr?.(text) })
  }

  const spawnFailed = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => { reject(error) })
  })
  spawnFailed.catch(() => { /* startup race observes this rejection */ })

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
      spawnFailed,
    ])
  } catch (error: unknown) {
    await disposeProcess(child).catch(() => {})
    throw error
  }

  let disposal: Promise<void> | undefined
  return {
    client,
    dispose(): Promise<void> {
      disposal ??= disposeProcess(child)
      return disposal
    },
  }
}
