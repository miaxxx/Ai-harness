import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CONFIG = readFileSync(new URL('../cordis.yml', import.meta.url), 'utf8')
const BASE_TOOL_SCHEMAS = JSON.parse(readFileSync(
  new URL('./snapshots/text-turn/tool-schemas.expected.json', import.meta.url),
  'utf8',
)) as { initial?: Array<{ name?: string }> }

const COMPUTER_ROWS = [
  'computer',
  'computer-browser-cdp',
  'computer-macos',
  'tool-computer',
] as const

function configRow(id: string): string {
  const marker = `- id: ${id}\n`
  const start = CONFIG.indexOf(marker)
  if (start < 0) throw new Error(`missing ACP config row ${id}`)
  const next = CONFIG.indexOf('\n- id:', start + marker.length)
  return CONFIG.slice(start, next < 0 ? undefined : next)
}

describe('ACP Computer Use composition', () => {
  it('keeps every Computer component behind the same explicit Desktop opt-in', () => {
    for (const id of COMPUTER_ROWS) {
      expect(configRow(id)).toContain(
        "disabled: !!js process.env.DSH_DESKTOP_COMPUTER_USE_ENABLED !== 'true'",
      )
    }
  })

  it('keeps the keyless base snapshot tool surface Computer-free while the feature is off', () => {
    const names = (BASE_TOOL_SCHEMAS.initial ?? []).map(tool => tool.name)
    expect(names).not.toContain('computer')
  })
})
