/** Schedule native identity renewal independently of renderer activity. */
export class DesktopIdentityRefreshTimer {
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private generation = 0

  /**
   * @param leadMs Time before access expiry at which renewal starts.
   * @param retryMs Delay after a failed renewal.
   * @param renew Renew native credentials and synchronize the linked browser cookie.
   */
  constructor(
    private readonly leadMs: number,
    private readonly retryMs: number,
    private readonly renew: () => Promise<string | undefined>,
  ) {
    if (![leadMs, retryMs].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Identity refresh timing must use positive integer milliseconds')
    }
  }

  /**
   * Replace the pending deadline; an absent expiry cancels renewal.
   * @param expiresAt Current native access expiry.
   */
  schedule(expiresAt: string | undefined): void {
    const generation = ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.stopped || !expiresAt) return
    const expiry = Date.parse(expiresAt)
    if (!Number.isFinite(expiry)) throw new Error('Identity access expiry must be a valid timestamp')
    this.arm(Math.max(1, expiry - Date.now() - this.leadMs), generation)
  }

  /** Cancel pending renewal and prevent an in-flight completion from scheduling another attempt. */
  stop(): void {
    this.stopped = true
    this.schedule(undefined)
  }

  private arm(delay: number, generation: number): void {
    this.timer = setTimeout(() => { void this.tick(generation) }, Math.min(delay, 2_147_483_647))
    this.timer.unref()
  }

  private async tick(generation: number): Promise<void> {
    try {
      const expiry = await this.renew()
      if (!this.stopped && generation === this.generation) this.schedule(expiry)
    } catch {
      // Identity requests report failures to their callers; background retries never log credentials.
      if (!this.stopped && generation === this.generation) this.arm(this.retryMs, generation)
    }
  }
}
