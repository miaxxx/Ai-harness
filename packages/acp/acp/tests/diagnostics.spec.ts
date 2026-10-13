import { afterEach, describe, expect, it } from 'vitest'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

let harness: BridgeHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
describe('ACP diagnostic metadata', () => {
  it('redacts credential text before publishing it over the protocol', async () => {
    harness = await makeBridgeHarness({ config: { diagnosticUpdates: true }, persona: 'cookie=private-cookie Bearer private-bearer', script: [textResponse('done')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hello' }] })
    const diagnostics = harness.updates.filter(update =>
      update.sessionUpdate === 'session_info_update' && update._meta?.harnessDiagnostics !== undefined)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(JSON.stringify(diagnostics)).not.toMatch(/private-cookie|private-bearer/)
  })
  it('publishes the assembled prompt, tool definitions, events, and statuses when enabled', async () => {
    harness = await makeBridgeHarness({ config: { diagnosticUpdates: true }, persona: 'diagnostic persona', script: [textResponse('done')] })
    harness.ctx.tools.register(defineContentToolFixture({ name: 'diagnostic_echo', description: 'Echo.', parameters: {}, execute: async () => [{ type: 'text', text: 'echo' }] }))
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'request evidence' }] })
    const evidence = harness.updates.flatMap(update => update.sessionUpdate === 'session_info_update'
      ? [update._meta?.harnessDiagnostics as {
        kind: string
        data: { system?: string; messages?: unknown; tools?: unknown; type?: string }
      }]
      : [])
    const request = evidence.find(item => item.kind === 'model-request')
    expect(request?.data.system).toContain('diagnostic persona')
    expect(JSON.stringify(request?.data.messages)).toContain('request evidence')
    expect(request?.data.tools).toBeDefined()
    expect(evidence.some(item => item.kind === 'session-event' && item.data.type === 'turn/end')).toBe(true)
    expect(evidence.some(item => item.kind === 'agent-status')).toBe(true)
  })

  it('bounds oversized Unicode request metadata with an explicit truncation marker', async () => {
    harness = await makeBridgeHarness({ config: { diagnosticUpdates: true, diagnosticMaxBytes: 1024 }, persona: '长'.repeat(2000), script: [textResponse('done')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hello' }] })
    const request = harness.updates.find(update => update.sessionUpdate === 'session_info_update'
      && (update._meta?.harnessDiagnostics as { kind?: string } | undefined)?.kind === 'model-request')
    if (request?.sessionUpdate !== 'session_info_update') throw new Error('Missing diagnostic request')
    const evidence = request._meta?.harnessDiagnostics as { data: { truncated?: boolean } }
    expect(evidence.data.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(1024)
  })

  it('keeps diagnostic request metadata opt-in', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('done')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hello' }] })
    expect(harness.updates.some(update => update.sessionUpdate === 'session_info_update' && update._meta?.harnessDiagnostics !== undefined)).toBe(false)
  })
})
