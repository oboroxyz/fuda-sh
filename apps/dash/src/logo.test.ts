import { describe, expect, it, vi } from 'vitest'

import {
  cropOf,
  EMPTY_LOGO,
  generateLogoSet,
  LOGO_SIDE,
  MAX_OBJECT_BYTES,
  MAX_SOURCE_BYTES,
  withLogoResult,
} from './logo.ts'
import type { ImageSize, LogoResult, LogoTools, SquareCrop } from './logo.ts'

// The pipeline never touches a DOM: the canvas and the decoder are injected, so
// the node test run can watch exactly what would have been drawn.
interface Drawn {
  crop: SquareCrop
  image: ImageSize
  side: number
}

const pngOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

const sourceOf = (type = 'image/png', bytes = 4096): File =>
  new File([new Uint8Array(bytes)], 'logo.png', { type })

interface Fixture {
  drawn: Drawn[]
  tools: LogoTools<ImageSize>
}

const fakeTools = (
  image: ImageSize | null,
  exported: (side: number) => Blob | null = () => pngOf(64),
): Fixture => {
  const drawn: Drawn[] = []
  const tools: LogoTools<ImageSize> = {
    createCanvas: (side) => ({
      drawSquare: (source, crop) => {
        drawn.push({ crop, image: source, side })
      },
      toPng: async () => await Promise.resolve(exported(side)),
    }),
    decode: async () => await Promise.resolve(image),
  }
  return { drawn, tools }
}

describe('the centre square crop', () => {
  it('takes the centre square of a wider-than-tall source', () => {
    expect(cropOf({ height: 660, width: 1000 })).toStrictEqual({ side: 660, x: 170, y: 0 })
  })

  it('takes the centre square of a taller-than-wide source and leaves a square alone', () => {
    expect(cropOf({ height: 1000, width: 800 })).toStrictEqual({ side: 800, x: 0, y: 100 })
    expect(cropOf({ height: 1024, width: 1024 })).toStrictEqual({ side: 1024, x: 0, y: 0 })
  })
})

describe('the logo pipeline', () => {
  it('draws every variant at exactly its own side', async () => {
    const { drawn, tools } = fakeTools({ height: 1024, width: 1024 })
    const result = await generateLogoSet(sourceOf(), tools)
    expect(result.ok).toBe(true)
    expect(drawn.map((entry) => entry.side)).toStrictEqual([1024, 50, 100, 150])
    expect(result.ok && Object.keys(result.variants).toSorted()).toStrictEqual([
      'logo1x',
      'logo2x',
      'logo3x',
      'master',
    ])
    expect(LOGO_SIDE.master).toBe(1024)
  })

  it('centre-crops a non-square source rather than distorting it', async () => {
    const { drawn, tools } = fakeTools({ height: 700, width: 1400 })
    await generateLogoSet(sourceOf(), tools)
    expect(drawn).toHaveLength(4)
    expect(drawn.every((entry) => entry.crop.side === 700)).toBe(true)
    expect(drawn[0]?.crop).toStrictEqual({ side: 700, x: 350, y: 0 })
  })

  it('accepts jpeg and webp sources alongside png', async () => {
    const { tools } = fakeTools({ height: 800, width: 800 })
    const jpeg = await generateLogoSet(sourceOf('image/jpeg'), tools)
    const webp = await generateLogoSet(sourceOf('image/webp'), tools)
    expect(jpeg.ok).toBe(true)
    expect(webp.ok).toBe(true)
  })

  it('refuses a file that is not one of the three image types', async () => {
    const { drawn, tools } = fakeTools({ height: 1024, width: 1024 })
    const result = await generateLogoSet(sourceOf('image/gif'), tools)
    expect(result).toStrictEqual({ ok: false, reason: 'type' })
    expect(drawn).toHaveLength(0)
  })

  it('refuses a source over 10 MiB before decoding a byte of it', async () => {
    const decode = vi.fn<LogoTools<ImageSize>['decode']>()
    const { tools } = fakeTools({ height: 1024, width: 1024 })
    const result = await generateLogoSet(sourceOf('image/png', MAX_SOURCE_BYTES + 1), {
      ...tools,
      decode,
    })
    expect(result).toStrictEqual({ ok: false, reason: 'tooLarge' })
    expect(decode).not.toHaveBeenCalled()
  })

  it('refuses a source the browser could not decode', async () => {
    const { tools } = fakeTools(null)
    await expect(generateLogoSet(sourceOf(), tools)).resolves.toStrictEqual({ ok: false, reason: 'decode' })
  })

  it('refuses a source whose smaller side is under 660, which the master would upscale', async () => {
    const { drawn, tools } = fakeTools({ height: 659, width: 2000 })
    const result = await generateLogoSet(sourceOf(), tools)
    expect(result).toStrictEqual({ ok: false, reason: 'tooSmall' })
    expect(drawn).toHaveLength(0)
  })

  it('refuses a set the api would reject for weight', async () => {
    const { tools } = fakeTools({ height: 1024, width: 1024 }, () => pngOf(MAX_OBJECT_BYTES + 1))
    await expect(generateLogoSet(sourceOf(), tools)).resolves.toStrictEqual({ ok: false, reason: 'tooHeavy' })
  })

  it('refuses a variant the canvas could not export', async () => {
    const { tools } = fakeTools({ height: 1024, width: 1024 }, (side) => (side === 50 ? null : pngOf(64)))
    await expect(generateLogoSet(sourceOf(), tools)).resolves.toStrictEqual({ ok: false, reason: 'encode' })
  })
})

describe('the picked logo state', () => {
  it('holds the generated blobs with a preview of the master', () => {
    const variants = { logo1x: pngOf(1), logo2x: pngOf(2), logo3x: pngOf(3), master: pngOf(4) }
    const result = { ok: true, variants } satisfies LogoResult
    const state = withLogoResult(result, () => 'blob:preview')
    expect(state.rejection).toBeNull()
    expect(state.pick?.previewUrl).toBe('blob:preview')
    expect(state.pick?.variants).toStrictEqual(variants)
  })

  it('clears the held pick when the next file is refused, and names the reason', () => {
    const state = withLogoResult({ ok: false, reason: 'tooSmall' }, () => 'blob:preview')
    expect(state).toStrictEqual({ pick: null, rejection: 'tooSmall' })
    expect(EMPTY_LOGO).toStrictEqual({ pick: null, rejection: null })
  })
})
