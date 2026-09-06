/**
 * Bounded model-facing directory inspection over the filesystem provider.
 * @module @deepseek-ai/dsh-tool-fs/src/list-directory
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './session-cwd.ts'

/** Default and maximum number of direct children returned by one call. */
export const LIST_DIRECTORY_LIMIT = 200

interface ListDirectoryInput {
  directoryPath: string
  offset: number
  limit: number
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

/**
 * Validate one directory-list request and apply its bounded defaults.
 * @param args Untrusted tool arguments.
 * @param maxLimit Deployment maximum and default page size.
 * @returns A validated request with explicit pagination.
 */
export function parseListDirectoryArgs(
  args: { directory_path: string; offset?: number; limit?: number },
  maxLimit: number,
): ListDirectoryInput {
  if (args.directory_path.trim().length === 0) throw new Error('directory_path must be a non-empty string')
  const offset = args.offset === undefined ? 1 : positiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? maxLimit : positiveInteger(args.limit, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { directoryPath: args.directory_path, offset, limit }
}

/**
 * Register bounded, non-recursive directory inspection.
 * @param ctx Cordis context owning the filesystem and tool registries.
 * @param maxLimit Deployment maximum and default page size.
 */
export function applyListDirectoryTool(ctx: Context, maxLimit: number): void {
  ctx.tools.register(defineTool({
    name: 'list_directory',
    description: 'List the direct children of a directory without reading file contents. Use this before describing an attached directory; do not infer its contents from the directory name.',
    parameters: {
      directory_path: { type: 'string', required: true, description: 'Path to the directory, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first entry to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of entries to return. Defaults to ${maxLimit}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                path: { type: 'string', required: true },
                type: { type: 'string', required: true, enum: ['file', 'directory', 'other'] },
                size: { type: 'integer' },
              },
            },
          },
          totalEntries: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `<path>${value.path}</path>`,
          '<type>directory</type>',
          `<entries offset="${value.offset}" total="${value.totalEntries}">`,
          ...value.entries.map(entry => JSON.stringify(entry)),
          '</entries>',
        ].join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseListDirectoryArgs(args, maxLimit)
      const target = await ctx.fs.resolve(input.directoryPath, sessionResolveOptions(exec, input.directoryPath))
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
        throw new FsError(`cannot list "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'directory') {
        throw new FsError(`cannot list "${target.displayPath}": not a directory`, 'FS_NOT_DIRECTORY')
      }
      const entries = await ctx.fs.listDir(target, exec.signal)
      const start = input.offset - 1
      const selected = entries.slice(start, start + input.limit).map(entry => ({
        name: entry.name,
        path: entry.target.displayPath,
        type: entry.type,
        ...(entry.size === undefined ? {} : { size: entry.size }),
      }))
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return { path: target.displayPath, offset: input.offset, entries: selected, totalEntries: entries.length }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `List ${args.directory_path}`,
        kind: 'read',
        locations: [{ path: args.directory_path }],
      }
    },
  }))
}
