import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OrbisHeroMark, OrbisSidebarMark, OrbisSidebarName, inject,
} from '../src/desktop-brand.tsx'

describe('Desktop Orbis brand', () => {
  it('uses the slot registry as its only service dependency', () => {
    expect(inject).toEqual(['slots'])
  })

  it('renders Orbis in the expanded sidebar and a compact monogram in the rail', () => {
    expect(OrbisSidebarMark({ size: 24, wide: true })).toBeNull()
    expect(renderToStaticMarkup(OrbisSidebarMark({ size: 24, wide: false }))).toContain('>O<')
    expect(renderToStaticMarkup(OrbisSidebarName({}))).toContain('>Orbis<')
  })

  it('leaves the Orbis AI hero headline unprefixed by a mark', () => {
    expect(OrbisHeroMark({ size: 34 })).toBeNull()
  })
})
