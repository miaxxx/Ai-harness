/**
 * Register a You.com-backed provider in the shared web capability.
 * @module @deepseek-ai/dsh-web-search-you
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { YouSearchProvider, YOU_DEFAULT_BASE_URL } from './provider.ts'

export { YouSearchProvider, YOU_DEFAULT_BASE_URL, YOU_DEFAULT_NUM_RESULTS, YOU_PROVIDER_ID } from './provider.ts'
export type { YouSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-you'
/** The provider contributes to the provider registry owned by `ctx.web`. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'YDC_API_KEY'

/** Optional deployment fields for the You.com search endpoint. */
export interface Config {
  /** Literal API key; prefer {@link apiKeyEnv} so secrets stay out of configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search. Defaults to `YDC_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/search` is appended. */
  baseURL?: string
  /** Default count sent when a request has no `maxResults`. */
  numResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  numResults: z.number().step(1).min(1),
})

/** Register the provider, resolving credentials from explicit config before the credential service. */
export function apply(ctx: Context, config: Config): void {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  ctx.web.registerSearchProvider(new YouSearchProvider({
    ...config.apiKey === undefined ? {} : { apiKey: config.apiKey },
    apiKeyEnv,
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value
    },
    baseURL: config.baseURL ?? YOU_DEFAULT_BASE_URL,
    ...config.numResults === undefined ? {} : { numResults: config.numResults },
  }))
}
