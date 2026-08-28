/**
 * Versioned NDJSON carriage for forwarding WHATWG Fetch requests over a
 * supervised child process's stdio. The frames contain transport data only;
 * API envelopes remain opaque request bodies owned by the Fetch carrier.
 * @module @deepseek-ai/dsh-host-apiproxy/stdio-protocol
 */

import { z } from 'zod'

/** Exact protocol version required by both sides of one stdio connection. */
export const STDIO_FETCH_PROTOCOL_VERSION = 1

/** Request metadata accepted after the version handshake. */
export interface StdioFetchRequestFrame {
  type: 'request'
  /** Connection-local request identifier minted by the client. */
  id: string
  /** Absolute path and query beginning with `/api/`. */
  path: string
  /** HTTP method forwarded to the Fetch handler. */
  method: string
  /** Header pairs; duplicates remain distinct and ordered. */
  headers: [string, string][]
  /** UTF-8 request body, absent for requests without one. */
  body?: string | undefined
}

/** Client-to-host stdio frames. */
export type StdioFetchClientFrame =
  | { type: 'hello'; version: number }
  | StdioFetchRequestFrame
  | { type: 'cancel'; id: string }

/** Host-to-client stdio frames. */
export type StdioFetchServerFrame =
  | { type: 'ready'; version: number }
  | { type: 'response'; id: string; status: number; statusText: string; headers: [string, string][] }
  | { type: 'data'; id: string; chunk: string }
  | { type: 'end'; id: string }
  | { type: 'error'; id?: string | undefined; message: string; fatal: boolean }

const nonEmptyString = z.string().min(1)
const version = z.number().int()
const headers = z.array(z.tuple([z.string(), z.string()]))
const clientFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), version }),
  z.object({
    type: z.literal('request'), id: nonEmptyString, path: nonEmptyString,
    method: nonEmptyString, headers, body: z.string().optional(),
  }),
  z.object({ type: z.literal('cancel'), id: nonEmptyString }),
]) satisfies z.ZodType<StdioFetchClientFrame>
const serverFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), version }),
  z.object({
    type: z.literal('response'), id: nonEmptyString,
    status: z.number().int().min(100).max(599), statusText: z.string(), headers,
  }),
  z.object({ type: z.literal('data'), id: nonEmptyString, chunk: nonEmptyString }),
  z.object({ type: z.literal('end'), id: nonEmptyString }),
  z.object({
    type: z.literal('error'), id: nonEmptyString.optional(),
    message: nonEmptyString, fatal: z.boolean(),
  }),
]) satisfies z.ZodType<StdioFetchServerFrame>

/**
 * Parse one unknown value as a host frame.
 * @param value - Value decoded from one NDJSON line.
 * @returns The validated host frame.
 */
export function parseStdioFetchServerFrame(value: unknown): StdioFetchServerFrame {
  return serverFrame.parse(value)
}

/**
 * Parse one unknown value as a client frame and reject invalid field types.
 * @param value - Value decoded from one NDJSON line or received through desktop IPC.
 * @returns The validated client frame.
 */
export function parseStdioFetchClientFrame(value: unknown): StdioFetchClientFrame {
  return clientFrame.parse(value)
}
