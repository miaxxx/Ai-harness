/** Host credential expiry is checked before a prompt can reach ACP. */
/**
 * Bound Host readiness by its delegation expiry and the planned rotation of its source human session.
 * @param delegatedExpiresAt Expiry returned by the delegation issuer.
 * @param sourceExpiresAt Persisted human access expiry, when present.
 * @param renewalLeadMs Native renewal lead time in milliseconds.
 * @returns The earliest deadline after which a prompt must obtain a new runtime credential.
 */
export function desktopRuntimeCredentialExpiry(
  delegatedExpiresAt: string,
  sourceExpiresAt: string | undefined,
  renewalLeadMs: number,
): string {
  const delegated = Date.parse(delegatedExpiresAt)
  const source = sourceExpiresAt === undefined ? undefined : Date.parse(sourceExpiresAt)
  if (!Number.isFinite(delegated) || (source !== undefined && !Number.isFinite(source))
    || !Number.isSafeInteger(renewalLeadMs) || renewalLeadMs < 0) throw new Error('企业运行凭证有效期无效。')
  return new Date(source === undefined ? delegated : Math.min(delegated, source - renewalLeadMs)).toISOString()
}

/** Admit prompts after credential renewal without interrupting active replies or replaying operations. */
export class DesktopRuntimeCredentialLifetime {
  private expiresAt: number | undefined
  private renewing: Promise<void> | undefined
  private active = 0

  /**
   * Record the expiry returned by the credential issuer, without retaining a token.
   * @param expiresAt Server expiry, or undefined for a runtime without delegation.
   */
  setExpiry(expiresAt: string | undefined): void {
    const parsed = expiresAt === undefined ? undefined : Date.parse(expiresAt)
    if (parsed !== undefined && !Number.isFinite(parsed)) throw new Error('企业运行凭证有效期无效。')
    this.expiresAt = parsed
  }

  private expired(): boolean {
    return this.expiresAt !== undefined && this.expiresAt <= Date.now()
  }

  /**
   * Renew an expired idle runtime before sending a prompt; never retry its operations.
   * @param renew Replaces the runtime, records its new expiry, and restores sessions.
   * @param operation Sends one prompt after credential readiness.
   * @returns The prompt result; renewal and execution errors propagate unchanged.
   */
  async run<T>(renew: () => Promise<void>, operation: () => Promise<T>): Promise<T> {
    if (this.renewing) await this.renewing
    if (this.expired()) {
      if (this.active > 0) throw new Error('企业凭证已到期，请等待当前回复结束后重试。')
      const pending = Promise.resolve().then(renew)
      this.renewing = pending
      try { await pending } finally { if (this.renewing === pending) this.renewing = undefined }
      if (this.expired()) throw new Error('企业凭证续期未完成，请重新登录。')
    }
    this.active++
    try { return await operation() } finally { this.active-- }
  }
}
