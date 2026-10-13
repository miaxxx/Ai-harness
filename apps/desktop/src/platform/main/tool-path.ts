/** Resolve the executable search path inherited by the standalone Desktop Runtime. */

import { execFile } from 'node:child_process'
import { delimiter, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PATH_START = '__MONA_LOGIN_PATH_START__'
const PATH_END = '__MONA_LOGIN_PATH_END__'
const LOGIN_PATH_COMMAND = `printf '\n${PATH_START}%s${PATH_END}\n' "$PATH"`

interface LoginShellResult {
  stdout: string
}

type LoginShellRunner = (
  file: string,
  args: string[],
  options: {
    encoding: 'utf8'
    env: NodeJS.ProcessEnv
    maxBuffer: number
    timeout: number
  },
) => Promise<LoginShellResult>

/** Merge path lists in priority order while removing empty and duplicate entries. */
export function mergeExecutablePaths(...values: (string | undefined)[]): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const value of values) {
    for (const entry of value?.split(delimiter) ?? []) {
      if (entry === '' || seen.has(entry)) continue
      seen.add(entry)
      entries.push(entry)
    }
  }
  return entries.join(delimiter)
}

/** Extract the marked PATH while ignoring login-shell startup output. */
export function markedLoginPath(stdout: string): string | undefined {
  const start = stdout.lastIndexOf(PATH_START)
  if (start < 0) return undefined
  const valueStart = start + PATH_START.length
  const end = stdout.indexOf(PATH_END, valueStart)
  if (end < 0) return undefined
  const value = stdout.slice(valueStart, end).trim()
  return value === '' ? undefined : value
}

/** Read the user's interactive login PATH without evaluating its output. */
export async function macLoginPath(
  environment: NodeJS.ProcessEnv,
  run: LoginShellRunner = execFileAsync,
): Promise<string | undefined> {
  const configuredShell = environment.SHELL
  const shell = configuredShell !== undefined && isAbsolute(configuredShell)
    ? configuredShell
    : '/bin/zsh'
  try {
    const { stdout } = await run(shell, ['-ilc', LOGIN_PATH_COMMAND], {
      env: environment,
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: 3_000,
    })
    return markedLoginPath(stdout)
  } catch {
    return undefined
  }
}

/**
 * Build the Runtime PATH. Packaged Node wins, then user-installed toolchains,
 * the launch environment, and finally conventional macOS executable roots.
 */
export async function resolveDesktopToolPath(
  bundledNodeBin: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  readLoginPath: (environment: NodeJS.ProcessEnv) => Promise<string | undefined> = macLoginPath,
): Promise<string> {
  const loginPath = platform === 'darwin' ? await readLoginPath(environment) : undefined
  return mergeExecutablePaths(
    bundledNodeBin,
    loginPath,
    environment.PATH,
    platform === 'darwin' ? '/opt/homebrew/bin:/usr/local/bin' : undefined,
    '/usr/bin:/bin:/usr/sbin:/sbin',
  )
}
