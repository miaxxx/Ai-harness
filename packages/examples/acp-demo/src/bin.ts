#!/usr/bin/env node
/**
 * Boot an ACP stdio server from `cordis.yml`; usage is
 * `dsh-acp-demo [--config path]`, defaulting to `./cordis.yml`. Shared env
 * loading, Loader guards, snapshot config selection, and settled-tree boot live
 * in dsh-app-boot. Replay skips `.env` and selects sibling
 * `cordis.snapshot.yml` so a stray key cannot trigger a model call. EOF owns
 * process teardown in every mode: the ACP client closes stdin, then the Runtime
 * disposes its Cordis tree and flushes durable sessions before exiting. Stdout
 * is reserved for JSON-RPC, so diagnostics go only to stderr.
 * @module @deepseek-ai/dsh-acp-demo/bin
 */

import { parseArgs } from 'node:util'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh-acp-demo'

/* v8 ignore start -- thin self-executing composition over the unit-tested
   dsh-app-boot helpers; exercised end-to-end by the snapshot suite and the
   built-bin smoke */
installFailLoud(NAME)
const snapshotMode = process.env['DSH_SNAPSHOT']
if (snapshotMode !== 'replay') loadEnv(NAME)
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { config: { type: 'string', short: 'c' } },
  strict: true,
})
const ctx = await boot(NAME, resolveConfigPath(values.config ?? './cordis.yml', snapshotMode))

let closing = false
const closeOnEof = (): void => {
  if (closing) return
  closing = true
  void ctx.fiber.dispose().then(() => { process.exit(0) })
}
// EOF can race a slow boot (for example a caller that closes stdin
// immediately). Handle the already-ended state as well as the ordinary event.
if (process.stdin.readableEnded) closeOnEof()
else process.stdin.once('end', closeOnEof)
/* v8 ignore stop */