import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as toolObis from '../src/index.ts'

class TestCredentialProvider extends CredentialProvider {
  readonly resolved: CredentialRef[] = []

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolved.push(ref)
    return { value: 'test-access-token', source: 'test' }
  }

  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: true, source: 'test', writable: false }
  }

  async set(): Promise<void> { throw new Error('read-only test credential provider') }
  async unset(): Promise<void> { throw new Error('read-only test credential provider') }
  async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> { return undefined }
  async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> { return { configured: false, writable: false } }
  async listRecords(): Promise<readonly CredentialRecordEntry[]> { return [] }
  async modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> { return undefined }
  async deleteRecord(): Promise<void> {}
}

const placeholder = (name: string) => defineTool({
  name,
  description: 'placeholder',
  parameters: {},
  output: {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  },
  execute: async () => ({ ok: true }),
})

describe('tool-obis native composition', () => {
  it('registers the six governed OBIS tools and unwinds them with the plugin fiber', async () => {
    const ctx = new Context()
    const promptFiber = ctx.plugin(SystemPrompt)
    await promptFiber
    const toolFiber = ctx.plugin(ToolRuntime)
    await toolFiber
    const credentialFiber = ctx.plugin(TestCredentialProvider)
    await credentialFiber
    const approvalFiber = ctx.plugin(ApprovalService)
    await approvalFiber

    const obisFiber = ctx.plugin(toolObis, {
      baseUrl: 'https://obis.example.test',
      environmentId: 'prod',
      credentialRef: 'OBIS_ACCESS_TOKEN',
      runId: 'run-1',
      capabilityLease: 'lease-1',
    })
    await obisFiber

    for (const name of [
      'obis_context',
      'obis_query',
      'obis_get_object',
      'obis_search_knowledge',
      'obis_propose_action',
      'obis_get_task',
    ]) {
      expect(() => ctx.tools.register(placeholder(name))).toThrow(/already registered/)
    }

    // Credentials are resolved lazily by the bridge on each operation, never at
    // plugin composition time. This keeps refresh/keychain rotation outside the
    // Tool layer and prevents long-lived token caching.
    expect(ctx.credentials).toBeInstanceOf(TestCredentialProvider)
    expect((ctx.credentials as TestCredentialProvider).resolved).toEqual([])

    await obisFiber.dispose()

    // Fiber disposal must release every model-facing tool registration so HMR,
    // preset replacement and tests cannot leave a stale enterprise authority.
    const dispose = ctx.tools.register(placeholder('obis_context'))
    dispose()

    await approvalFiber.dispose()
    await credentialFiber.dispose()
    await toolFiber.dispose()
    await promptFiber.dispose()
  })

  it('rejects invalid credential references before registering tools', async () => {
    const ctx = new Context()
    const promptFiber = ctx.plugin(SystemPrompt)
    await promptFiber
    const toolFiber = ctx.plugin(ToolRuntime)
    await toolFiber
    const credentialFiber = ctx.plugin(TestCredentialProvider)
    await credentialFiber
    const approvalFiber = ctx.plugin(ApprovalService)
    await approvalFiber

    const fiber = ctx.plugin(toolObis, {
      baseUrl: 'https://obis.example.test',
      environmentId: 'prod',
      credentialRef: 'not a credential ref',
    })
    await expect(fiber).rejects.toThrow(/credential ref/)

    const dispose = ctx.tools.register(placeholder('obis_context'))
    dispose()

    await approvalFiber.dispose()
    await credentialFiber.dispose()
    await toolFiber.dispose()
    await promptFiber.dispose()
  })
})
