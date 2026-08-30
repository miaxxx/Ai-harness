import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { createUserMessage, CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

function toolCallResponse(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId('call-1'), name: 'echo', argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('call-1'), name: 'echo', arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

describe('ACP product output boundary', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('emits semantic tool lifecycle and streams visible assistant text', async () => {
    harness = await makeBridgeHarness({ script: [toolCallResponse(), textResponse('done')] })
    harness.ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'Return a deterministic result.',
      parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: 'tool result' }]),
    }))
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })

    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(7) })
    expect(harness.updates.map(update => update.sessionUpdate)).toEqual([
      'user_message_chunk',
      'tool_call',
      'tool_call_update',
      'agent_message_chunk', 'agent_message_chunk', 'agent_message_chunk', 'agent_message_chunk',
    ])
    expect(harness.updates[1]).toEqual(expect.objectContaining({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'echo',
      status: 'in_progress',
    }))
    expect(harness.updates[2]).toEqual(expect.objectContaining({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
    }))
    expect(harness.updates.slice(3).flatMap(update => (
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []
    )).join('')).toBe('done')
    expect(harness.updates.some(update => update.sessionUpdate === 'agent_thought_chunk')).toBe(false)
  })

  it('ignores events from agents the bridge does not own', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('foreign')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const { agent } = await harness.ctx.agents.create({
      sessionId: SessionId('foreign'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(harness.updates).toHaveLength(0)
  })

  it('hides plugin-authored context while delivering model output from an in-process producer', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('external')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.get(SessionId(sessionId))!

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'plugin', plugin: 'test' } }))
    await agent.whenIdle()
    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(8) })

    expect(harness.updates.flatMap(update => (
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []
    )).join('')).toBe('external')
  })

  it('contains output conversion failure outside an ACP prompt without exposing plugin context', async () => {
    harness = await makeBridgeHarness({ script: [[
      { type: 'block-start', index: 0, blockType: 'image' },
      {
        type: 'block-end',
        index: 0,
        block: {
          type: 'image',
          attachment: {
            attachmentId: `sha256:${'a'.repeat(64)}` as never,
            mediaType: 'image/png',
            bytes: 1,
            width: 1,
            height: 1,
          },
        },
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ]] })
    const warn = vi.spyOn(harness.ctx.logger, 'warn')
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.get(SessionId(sessionId))!

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'plugin', plugin: 'test' } }))
    await agent.whenIdle()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('session projection delivery failed')) })
    expect(harness.updates).toHaveLength(0)
  })

  // `session/update` is a JSON-RPC notification, so a client-side handler
  // failure never reaches the bridge; this pins that the prompt still settles
  // normally with such a client. The bridge's own write-failure guard is
  // transport-level and documented untestable at `notify`.
  it('settles the prompt normally when the client rejects update notifications', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('answer')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    harness.onSessionUpdateError = () => {}
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
  })
})
