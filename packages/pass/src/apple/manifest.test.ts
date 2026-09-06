import { describe, expect, it } from 'vitest'

import { iconPng } from './icon.ts'
import { manifestOf } from './manifest.ts'

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

describe(manifestOf, () => {
  it('keys the SHA-1 hex of each file by its name', async () => {
    const manifest = await manifestOf(new Map([['pass.json', bytes('abc')]]))
    expect(JSON.parse(manifest)).toStrictEqual({
      'pass.json': 'a9993e364706816aba3e25717850c26c9cd0d89d',
    })
  })

  it('keeps the insertion order of the files it was given', async () => {
    const manifest = await manifestOf(
      new Map([
        ['pass.json', bytes('abc')],
        ['icon.png', bytes('')],
      ]),
    )
    expect(Object.keys(JSON.parse(manifest) as Record<string, string>)).toStrictEqual([
      'pass.json',
      'icon.png',
    ])
  })
})

describe(iconPng, () => {
  it('is a PNG: the 8-byte signature, then IHDR', () => {
    const png = iconPng()
    expect(png.slice(0, 8)).toStrictEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(new TextDecoder().decode(png.slice(12, 16))).toBe('IHDR')
    // 29×29, the size Wallet asks of a non-retina icon.
    expect(new DataView(png.buffer).getUint32(16)).toBe(29)
    expect(new DataView(png.buffer).getUint32(20)).toBe(29)
  })
})
