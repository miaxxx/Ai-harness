/** Durable, non-secret business references carry selection intent, never authority. */
export interface ObisBusinessReference {
  kind: 'module' | 'applications' | 'spaces' | 'knowledge'
  projectId: string
  environmentId: string
  label: string
  moduleId?: string
  moduleVersion?: string
  pageId?: string
}

/**
 * Validate a composer or persisted business reference.
 * @param value Untrusted JSON received from a reference occurrence.
 * @returns Selection metadata; the Kernel still verifies publication and permission.
 */
export function parseObisBusinessReference(value: unknown): ObisBusinessReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('OBIS reference must be an object.')
  const row = value as Record<string, unknown>
  if (!['module', 'applications', 'spaces', 'knowledge'].includes(String(row.kind))) throw new TypeError('Unknown OBIS reference kind.')
  for (const field of ['projectId', 'environmentId', 'label']) {
    if (typeof row[field] !== 'string' || !row[field].trim() || row[field].length > 512) throw new TypeError(`Invalid OBIS reference ${field}.`)
  }
  const result: ObisBusinessReference = {
    kind: row.kind as ObisBusinessReference['kind'], projectId: row.projectId as string,
    environmentId: row.environmentId as string, label: row.label as string,
  }
  if (result.kind === 'module') {
    for (const field of ['moduleId', 'moduleVersion', 'pageId'] as const) {
      const entry = row[field]
      if (typeof entry !== 'string' || !entry.trim() || entry.length > 512) throw new TypeError(`Invalid OBIS reference ${field}.`)
      result[field] = entry
    }
  }
  return result
}

/**
 * Encode a reference as one model-visible line in the durable user prompt.
 * @param reference Selection already validated by its producer.
 * @returns A non-secret JSON marker; no credential or permission claim is included.
 */
export function serializeObisBusinessReference(reference: ObisBusinessReference): string {
  return `\n[obis-reference ${JSON.stringify(parseObisBusinessReference(reference))}]\n`
}

/**
 * Read business references from one durable human message.
 * @param text Logged user text, including serialized composer occurrences.
 * @returns Validated selections in message order; malformed markers reject the request.
 */
export function readObisBusinessReferences(text: string): ObisBusinessReference[] {
  const references: ObisBusinessReference[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('[obis-reference ')) continue
    if (!line.endsWith(']')) throw new TypeError('Malformed OBIS reference.')
    references.push(parseObisBusinessReference(JSON.parse(line.slice(16, -1))))
  }
  return references
}

/**
 * Preserve business reference labels in sent and replayed conversation text.
 * @param text Serialized user prompt; malformed markers remain visible.
 * @returns Display text without business routing fields.
 */
export function displayObisBusinessReferences(text: string): string {
  return text.replace(/^\[obis-reference (.+)\]$/gmu, (marker, encoded: string) => {
    try { return `@"${parseObisBusinessReference(JSON.parse(encoded)).label.replaceAll('"', "'")}"` }
    catch { return marker } // Invalid persisted markers remain visible for diagnosis.
  })
}
