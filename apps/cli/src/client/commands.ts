/** Product-facing CLI commands implemented exclusively through ACP. */

import { createInterface } from 'node:readline/promises'
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import { connectAcpRuntime } from '@deepseek-ai/dsh-acp-client'
import type { AcpRunInvocation, AcpSessionsInvocation } from '../args.ts'

export interface AcpCliIo {
  stdout: NodeJS.WriteStream
  stderr: Pick<NodeJS.WriteStream, 'write'>
  stdin: NodeJS.ReadStream
}

const PROCESS_IO: AcpCliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
}

function textFromUpdate(notification: SessionNotification): { role: 'user' | 'assistant'; text: string } | undefined {
  const update = notification.update
  if (update.sessionUpdate !== 'user_message_chunk' && update.sessionUpdate !== 'agent_message_chunk') return undefined
  if (update.content.type !== 'text') return undefined
  return {
    role: update.sessionUpdate === 'user_message_chunk' ? 'user' : 'assistant',
    text: update.content.text,
  }
}

/** Stable human renderer for durable transcript updates. */
export function renderAcpUpdate(notification: SessionNotification): string | undefined {
  const text = textFromUpdate(notification)
  if (text === undefined) return undefined
  return `${text.role}> ${text.text}\n`
}

async function requestPermission(
  request: RequestPermissionRequest,
  io: AcpCliIo,
  json: boolean,
): Promise<RequestPermissionResponse> {
  const allow = request.options.find(option => option.kind === 'allow_once' || option.kind === 'allow_always')
  // Machine mode and redirected stdin are fail-closed: product automation must
  // never turn a missing human prompt into implicit permission.
  if (json || ! io.stdin.isTTY || ! io.stdout.isTTY || allow === undefined) {
    return { outcome: { outcome: 'cancelled' } }
  }

  const reader = createInterface({ input: io.stdin, output: io.stdout })
  try {
    const answer = await reader.question(`Permission requested for tool call ${request.toolCall.toolCallId}. Allow once? [y/N] `)
    if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
      return { outcome: { outcome: 'cancelled' } }
    }
    return { outcome: { outcome: 'selected', optionId: allow.optionId } }
  } finally {
    reader.close()
  }
}

export async function runAcpPrompt(invocation: AcpRunInvocation, io: AcpCliIo = PROCESS_IO): Promise<void> {
  const updates: SessionNotification[] = []
  const runtime = await connectAcpRuntime({
    command: invocation.runtimeCommand,
    args: invocation.runtimeArgs,
    cwd: invocation.cwd,
  }, {
    onSessionUpdate(notification) {
      updates.push(notification)
      if (!invocation.json) {
        const rendered = renderAcpUpdate(notification)
        if (rendered !== undefined) io.stdout.write(rendered)
      }
    },
    onPermissionRequest: request => requestPermission(request, io, invocation.json),
  })

  let sessionId: string | undefined
  let stopReason: string | undefined
  try {
    if (invocation.sessionId === undefined) {
      const created = await runtime.client.newSession({ cwd: invocation.cwd, mcpServers: [] })
      sessionId = created.sessionId
    } else {
      sessionId = invocation.sessionId
      if (invocation.resume) {
        await runtime.client.resumeSession({ sessionId, cwd: invocation.cwd, mcpServers: [] })
      } else {
        await runtime.client.loadSession({ sessionId, cwd: invocation.cwd, mcpServers: [] })
      }
    }

    if (!invocation.json) io.stderr.write(`[session ${sessionId}]\n`)
    const result = await runtime.client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: invocation.prompt }],
    })
    stopReason = result.stopReason

    if (invocation.json) {
      io.stdout.write(`${JSON.stringify({ sessionId, stopReason, updates })}\n`)
    }
  } finally {
    if (sessionId !== undefined) {
      await runtime.client.closeSession({ sessionId }).catch(() => {})
    }
    await runtime.dispose()
  }
}

export async function listAcpSessions(invocation: AcpSessionsInvocation, io: AcpCliIo = PROCESS_IO): Promise<void> {
  const runtime = await connectAcpRuntime({
    command: invocation.runtimeCommand,
    args: invocation.runtimeArgs,
    cwd: invocation.cwd,
  }, {
    onSessionUpdate() {},
    onPermissionRequest: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
  })

  try {
    const request = invocation.cursor === undefined
      ? { cwd: invocation.cwd }
      : { cwd: invocation.cwd, cursor: invocation.cursor }
    const result = await runtime.client.listSessions(request)
    if (invocation.json) {
      io.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    for (const session of result.sessions) {
      io.stdout.write(`${session.sessionId}\t${session.cwd}\n`)
    }
    const nextCursor: unknown = Reflect.get(result, 'nextCursor')
    if (typeof nextCursor === 'string') io.stderr.write(`[next cursor ${nextCursor}]\n`)
  } finally {
    await runtime.dispose()
  }
}
