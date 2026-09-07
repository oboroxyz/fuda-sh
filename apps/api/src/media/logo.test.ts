import { describe, expect, it } from 'vitest'

import {
  isLogoPrefix,
  isLogoVariant,
  LOGO_SIDE,
  MAX_LOGO_OBJECT_BYTES,
  objectKey,
  readPngHeader,
  validateLogoSet,
} from './logo.ts'

// A PNG whose signature and IHDR are real; the rest of the file is irrelevant
// to a header read, which is exactly the point of reading only the header.
const png = (width: number, height: number, padding = 0): Uint8Array => {
  const bytes = new Uint8Array(24 + padding)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(12, 0x49_48_44_52)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

const squareSet = (over: Partial<Record<string, Uint8Array>> = {}): Map<string, Uint8Array> => {
  const parts = new Map<string, Uint8Array>()
  for (const [variant, side] of Object.entries(LOGO_SIDE)) {
    parts.set(variant, png(side, side))
  }
  for (const [variant, bytes] of Object.entries(over)) {
    if (bytes === undefined) {
      parts.delete(variant)
    } else {
      parts.set(variant, bytes)
    }
  }
  return parts
}

describe(readPngHeader, () => {
  it('reads the side lengths straight out of IHDR', () => {
    expect(readPngHeader(png(1024, 1024))).toStrictEqual({ height: 1024, width: 1024 })
    expect(readPngHeader(png(50, 100))).toStrictEqual({ height: 100, width: 50 })
  })

  it('refuses anything that is not a PNG with an IHDR first chunk', () => {
    expect(readPngHeader(new Uint8Array(24))).toBeNull()
    expect(readPngHeader(png(50, 50).slice(0, 20))).toBeNull()
    const wrongChunk = png(50, 50)
    new DataView(wrongChunk.buffer).setUint32(12, 0x49_44_41_54)
    expect(readPngHeader(wrongChunk)).toBeNull()
  })
})

describe(validateLogoSet, () => {
  it('accepts a complete set of exactly sized squares', () => {
    const result = validateLogoSet(squareSet())
    expect(result.ok).toBe(true)
    expect(result.ok && result.objects.map((object) => object.variant)).toStrictEqual([
      'master',
      'logo1x',
      'logo2x',
      'logo3x',
    ])
  })

  it('names why a set was refused', () => {
    expect(validateLogoSet(squareSet({ logo2x: undefined }))).toStrictEqual({
      ok: false,
      reason: 'missing_variant',
    })
    expect(validateLogoSet(squareSet({ logo1x: png(64, 64) }))).toStrictEqual({
      ok: false,
      reason: 'wrong_size',
    })
    expect(validateLogoSet(squareSet({ master: new Uint8Array(24) }))).toStrictEqual({
      ok: false,
      reason: 'not_png',
    })
  })

  it('refuses an object over the per-object cap before reading its header', () => {
    const huge = png(1024, 1024, MAX_LOGO_OBJECT_BYTES)
    expect(validateLogoSet(squareSet({ master: huge }))).toStrictEqual({ ok: false, reason: 'too_large' })
  })
})

describe('logo keys', () => {
  it('accepts only prefixes this api writes', () => {
    expect(isLogoPrefix(`logos/${crypto.randomUUID()}`)).toBe(true)
    expect(isLogoPrefix('logos/../secret')).toBe(false)
    expect(isLogoPrefix('other/00000000-0000-0000-0000-000000000000')).toBe(false)
  })

  it('builds the object key and knows the variant names', () => {
    expect(objectKey('logos/abc', 'logo2x')).toBe('logos/abc/logo2x.png')
    expect(isLogoVariant('master')).toBe(true)
    expect(isLogoVariant('icon')).toBe(false)
  })
})
