import { delimiter } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  macLoginPath,
  markedLoginPath,
  mergeExecutablePaths,
  resolveDesktopToolPath,
} from '../src/platform/main/tool-path.ts'

describe('Desktop Runtime executable path', () => {
  it('keeps priority order while removing empty and duplicate entries', () => {
    expect(mergeExecutablePaths(
      `/embedded${delimiter}/usr/local/bin`,
      `/usr/local/bin${delimiter}${delimiter}/usr/bin`,
    )).toBe(`/embedded${delimiter}/usr/local/bin${delimiter}/usr/bin`)
  })

  it('extracts a marked login path without trusting shell startup output', () => {
    expect(markedLoginPath([
      'startup banner',
      '__MONA_LOGIN_PATH_START__/custom/bin:/usr/bin__MONA_LOGIN_PATH_END__',
      'trailing output',
    ].join('\n'))).toBe('/custom/bin:/usr/bin')
    expect(markedLoginPath('startup banner only')).toBeUndefined()
    expect(markedLoginPath('__MONA_LOGIN_PATH_START__/missing-end')).toBeUndefined()
    expect(markedLoginPath('__MONA_LOGIN_PATH_START__   __MONA_LOGIN_PATH_END__')).toBeUndefined()
  })

  it('reads a marked path from the configured login shell and tolerates failure', async () => {
    const calls: unknown[][] = []
    const result = await macLoginPath({ SHELL: '/bin/fish', PATH: '/launch/bin' }, async (...args) => {
      calls.push(args)
      return {
        stdout: 'banner\n__MONA_LOGIN_PATH_START__/login/bin:/usr/bin__MONA_LOGIN_PATH_END__\n',
      }
    })

    expect(result).toBe('/login/bin:/usr/bin')
    expect(calls[0]?.[0]).toBe('/bin/fish')
    expect(calls[0]?.[1]).toEqual(['-ilc', expect.stringContaining('__MONA_LOGIN_PATH_START__')])
    expect(calls[0]?.[2]).toMatchObject({ timeout: 3_000, encoding: 'utf8' })

    const failed = await macLoginPath({ SHELL: 'relative-shell' }, async (shell) => {
      expect(shell).toBe('/bin/zsh')
      throw new Error('shell startup failed')
    })
    expect(failed).toBeUndefined()
  })

  it('prepends packaged Node and supplies conventional fallback roots', async () => {
    const resolved = await resolveDesktopToolPath('/app/runtime/node/bin', {
      PATH: `/launch/bin${delimiter}/usr/bin`,
    }, 'linux')

    expect(resolved.split(delimiter)).toEqual([
      '/app/runtime/node/bin',
      '/launch/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ])
  })

  it('places the macOS login path ahead of the Finder launch path', async () => {
    const resolved = await resolveDesktopToolPath(undefined, {
      PATH: '/usr/bin:/bin',
    }, 'darwin', async () => '/opt/custom/bin:/usr/local/bin')

    expect(resolved.split(delimiter)).toEqual([
      '/opt/custom/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/opt/homebrew/bin',
      '/usr/sbin',
      '/sbin',
    ])
  })
})
