import { describe, expect, it } from 'vitest'

import { qrSvg } from './qr-svg.ts'

const UID = `0x${'ab'.repeat(32)}`

const viewBoxWidth = (s: string): number => Number(/viewBox="0 0 (?<w>\d+)/u.exec(s)?.groups?.w ?? '0')

const viewBoxOf = (s: string): string | undefined => /viewBox="[^"]+"/u.exec(s)?.[0]

describe(qrSvg, () => {
  it('returns one self-contained svg with a module-unit viewBox', () => {
    const svg = qrSvg(`fuda:v1:${UID}`)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBeTruthy()
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/u)
    expect(svg).toContain('<path d="M')
    expect(svg).not.toContain('href=')
  })

  it('is deterministic and changes with the payload', () => {
    const a = qrSvg('fuda:v1:0x00')
    expect(qrSvg('fuda:v1:0x00')).toBe(a)
    expect(qrSvg('fuda:v1:0x01')).not.toBe(a)
  })

  it('honours the quiet zone in the viewBox size', () => {
    const noQuiet = qrSvg('x', { quiet: 0 })
    const quiet = qrSvg('x', { quiet: 4 })
    expect(viewBoxWidth(quiet) - viewBoxWidth(noQuiet)).toBe(8)
  })

  it('marks the top-left finder pattern as dark on its border', () => {
    const svg = qrSvg('x', { quiet: 0 })
    // uqr's own matrix already carries a 1-module light border, so the
    // finder pattern's 7x7 outer ring starts at (1,1) and runs to (7,1).
    expect(svg).toContain('M1 1h1v1h-1z')
    expect(svg).toContain('M7 1h1v1h-1z')
  })

  it('scales the rendered width and height with modulePx', () => {
    const small = qrSvg('x', { modulePx: 100 })
    const large = qrSvg('x', { modulePx: 300 })
    expect(small).toContain('width="100" height="100"')
    expect(large).toContain('width="300" height="300"')
  })

  it('keeps the viewBox in module units regardless of modulePx', () => {
    const small = qrSvg('x', { modulePx: 100 })
    const large = qrSvg('x', { modulePx: 300 })
    expect(viewBoxOf(small)).toBe(viewBoxOf(large))
  })
})
