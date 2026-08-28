/**
 * Commander adapter for the `dsh` command line.
 *
 * The legacy/default path still boots a named Harness profile. Product-facing
 * `run` and `sessions` commands are different: they are ACP clients and never
 * call Agent/Session/Tool internals directly.
 * @module @deepseek-ai/dsh/args
 */

import { Command, CommanderError } from 'commander'

interface ProfileInvocation {
  mode: 'profile'
  profile: string
  patches: string[]
  args: string[]
}

interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  defaultOnly: boolean
  patches: string[]
}

interface PluginInvocation {
  mode: 'plugin'
  profile: string
  args: string[]
}

export interface AcpRuntimeInvocation {
  runtimeCommand: string
  runtimeArgs: string[]
  cwd: string
  json: boolean
}

export interface AcpRunInvocation extends AcpRuntimeInvocation {
  mode: 'acp-run'
  prompt: string
  sessionId?: string
  /** Restore without replay. Requires sessionId. */
  resume: boolean
}

export interface AcpSessionsInvocation extends AcpRuntimeInvocation {
  mode: 'acp-sessions'
  cursor?: string
}

export type DshInvocation =
  | ProfileInvocation
  | DumpConfigInvocation
  | PluginInvocation
  | AcpRunInvocation
  | AcpSessionsInvocation

interface BootOptions {
  patch?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
}

interface AcpRuntimeOptions {
  runtimeCommand: string
  runtimeArg?: string[]
  cwd: string
  json?: boolean
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

const HELP_EXAMPLES = `
Examples:
  dsh run --runtime-command dsh-acp-runtime "fix the tests"
  dsh run --runtime-command dsh-acp-runtime --session <id> "continue"
  dsh sessions --runtime-command dsh-acp-runtime
  dsh --profile web                          boot the web profile (same as: dsh web)
  dsh --profile tui --patch ./extra.yml      boot a custom Runtime profile
  dsh plugin --profile tui add <package>     install a plugin into the profile
`

function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): DshInvocation {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    return { mode: 'profile', profile, patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

function runtimeFields(command: Command, options: AcpRuntimeOptions): AcpRuntimeInvocation {
  if (options.runtimeCommand === '') command.error('error: --runtime-command needs an executable')
  if (options.cwd === '') command.error('error: --cwd needs a workspace path')
  return {
    runtimeCommand: options.runtimeCommand,
    runtimeArgs: options.runtimeArg ?? [],
    cwd: options.cwd,
    json: options.json === true,
  }
}

export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  let resolved: DshInvocation | undefined
  const program: Command = new Command()
  program
    .name('dsh')
    .version(version, '-V, --version', 'output the version number')
    .description('dsh: ACP product client plus profile-based Harness Runtime bootstrap.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the booted profile app')
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      if (options.profile === undefined) {
        if (args.some(argument => argument === '-h' || argument === '--help')) program.help()
        program.error('error: --profile <name> is required, or use dsh run / dsh sessions for ACP')
      }
      const profile = options.profile
      if (profile === '') program.error('error: --profile needs a name')
      resolved = resolveBoot(program, profile, options, args)
    })

  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const run = program.command('run').description('run one task through a standalone ACP Runtime')
  run
    .requiredOption('--runtime-command <command>', 'ACP Runtime executable to spawn')
    .option('--runtime-arg <arg>', 'argument passed to the Runtime executable (repeatable; use --runtime-arg=--flag for flag-shaped values)', collect)
    .option('--cwd <path>', 'workspace used for the Runtime process and ACP session', process.cwd())
    .option('--session <id>', 'load an existing durable ACP session before prompting')
    .option('--resume', 'restore --session without replaying historical presentation updates')
    .option('--json', 'emit one machine-readable JSON result')
    .argument('<prompt...>', 'task to send through session/prompt')
    .action((prompt: string[], options: AcpRuntimeOptions & { session?: string, resume?: boolean }) => {
      rejectParentOptions('run')
      if (options.resume === true && options.session === undefined) run.error('error: --resume requires --session <id>')
      if (options.session === '') run.error('error: --session needs an id')
      const text = prompt.join(' ').trim()
      if (text.length === 0) run.error('error: run needs a non-empty prompt')
      resolved = {
        mode: 'acp-run',
        ...runtimeFields(run, options),
        prompt: text,
        sessionId: options.session,
        resume: options.resume === true,
      }
    })

  const sessions = program.command('sessions').description('list durable sessions through ACP session/list')
  sessions
    .requiredOption('--runtime-command <command>', 'ACP Runtime executable to spawn')
    .option('--runtime-arg <arg>', 'argument passed to the Runtime executable (repeatable)', collect)
    .option('--cwd <path>', 'filter sessions to this workspace', process.cwd())
    .option('--cursor <cursor>', 'opaque cursor returned by a previous session/list')
    .option('--json', 'emit the ACP list response as JSON')
    .action((options: AcpRuntimeOptions & { cursor?: string }) => {
      rejectParentOptions('sessions')
      if (options.cursor === '') sessions.error('error: --cursor needs a value')
      resolved = {
        mode: 'acp-sessions',
        ...runtimeFields(sessions, options),
        cursor: options.cursor,
      }
    })

  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding arguments to pnpm')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('dsh: no invocation resolved')
  return resolved
}
