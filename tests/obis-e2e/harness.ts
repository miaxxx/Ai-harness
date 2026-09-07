import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CredentialProvider, {
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as toolObis from '../../packages/obis/tool-obis/src/index.ts'
import { environmentId, humanGoal, kernelBaseUrl, sessionId } from './fixture.ts'

let accessToken = ''

export function setHarnessAccessToken(value: string): void {
  accessToken = value
}

class TokenCredentialProvider extends CredentialProvider {
  async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return accessToken ? { value: accessToken, source: 'e2e' } : undefined
  }
  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: accessToken.length > 0, ...(accessToken ? { source: 'e2e' } : {}), writable: false }
  }
  async set(): Promise<void> { throw new Error('read-only') }
  async unset(): Promise<void> { throw new Error('read-only') }
  async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> { return undefined }
  async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> { return { configured: false, writable: false } }
  async listRecords(): Promise<readonly CredentialRecordEntry[]> { return [] }
  async modifyRecord(_key: CredentialKey, _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> { return undefined }
  async deleteRecord(): Promise<void> {}
}

export function fakeAgent(id = sessionId): Agent {
  const events: Array<Record<string, unknown>> = [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'user/message',
      data: {
        id: 'e2e-message', role: 'user',
        content: [{ type: 'text', text: humanGoal }],
        source: { kind: 'user' },
      },
    },
  ]
  const session = {
    events,
    append(type: string, data: Record<string, unknown>) {
      const event = { type, data }
      events.push(event)
      return event
    },
  }
  return { id, session } as unknown as Agent
}

type ToolCallId = Parameters<ToolRuntime['execute']>[0]['callId']

export async function mountGovernedHarness(installationId: string): Promise<{ ctx: Context; approvals: string[] }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenCredentialProvider)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(toolObis, {
    baseUrl: kernelBaseUrl,
    environmentId,
    credentialRef: 'OBIS_ACCESS_TOKEN',
    installationId,
    autonomy: 'human-approved',
  })
  const approvals: string[] = []
  ctx.on('approval/request', (request) => {
    approvals.push(request.reason ?? '')
    return Promise.resolve<ApprovalOutcome>('allowed-once')
  })
  return { ctx, approvals }
}

export async function nativeTool(ctx: Context, agent: Agent, callId: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await ctx.tools.execute({
    callId: callId as ToolCallId,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(result.isError, false, result.isError ? result.error.message : undefined)
  if (result.isError) throw result.error
  return result.value as Record<string, unknown>
}
