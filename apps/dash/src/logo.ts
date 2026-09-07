import { LOGO_SIDE, MAX_LOGO_OBJECT_BYTES, MAX_LOGO_SET_BYTES } from '@fuda/sdk'
import type { LogoVariant } from '@fuda/sdk'

// The venue's logo, drawn here rather than in the api: Workers have no image
// decoder, so the browser produces the four square PNGs and the api verifies
// them (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
// The canvas and the decoder are injected, so the whole pipeline runs in the
// node test run against fakes.

// The variant names, sides and caps are the api's contract, not this form's:
// they come from @fuda/sdk so a doomed upload is explained in the form instead
// of coming back as a bare 400.
export { LOGO_SIDE, LOGO_VARIANTS, MAX_LOGO_OBJECT_BYTES, MAX_LOGO_SET_BYTES } from '@fuda/sdk'
export type { LogoVariant } from '@fuda/sdk'

const BYTES_PER_MIB = 1024 * 1024

export const MAX_SOURCE_BYTES = 10 * BYTES_PER_MIB

// Below this the 1024 master would be upscaled, and an upscaled mark looks poor
// on a pass and on a poster.
export const MIN_SOURCE_SIDE = 660

export const SOURCE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

// What a file input should offer; the pipeline rejects anything else anyway.
export const SOURCE_ACCEPT = SOURCE_TYPES.join(',')

export type LogoSet = Record<LogoVariant, Blob>

// Why the pipeline refused a file, in the terms the form explains it.
export type LogoRejection = 'decode' | 'encode' | 'tooHeavy' | 'tooLarge' | 'tooSmall' | 'type'

export type LogoResult = { ok: true; variants: LogoSet } | { ok: false; reason: LogoRejection }

export interface ImageSize {
  height: number
  width: number
}

// The square region of the source that is drawn, in source pixels.
export interface SquareCrop {
  side: number
  x: number
  y: number
}

export interface LogoCanvas<TImage> {
  drawSquare: (image: TImage, crop: SquareCrop) => void
  // null when the drawing surface was unavailable, which is an `encode` refusal
  // rather than a thrown error.
  toPng: () => Promise<Blob | null>
}

export interface LogoTools<TImage extends ImageSize> {
  createCanvas: (side: number) => LogoCanvas<TImage>
  decode: (file: File) => Promise<TImage | null>
}

// The centre square of a source of any aspect: a wide photo loses its sides,
// never its proportions.
export const cropOf = ({ height, width }: ImageSize): SquareCrop => {
  const side = Math.min(height, width)
  return { side, x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2) }
}

const isSourceType = (type: string): boolean => SOURCE_TYPES.some((accepted) => accepted === type)

// What is knowable before a byte is decoded.
const sourceRejection = (file: File): LogoRejection | null => {
  if (!isSourceType(file.type)) {
    return 'type'
  }
  return file.size > MAX_SOURCE_BYTES ? 'tooLarge' : null
}

const withinCaps = (blobs: Blob[]): boolean =>
  blobs.every((blob) => blob.size <= MAX_LOGO_OBJECT_BYTES) &&
  blobs.reduce((sum, blob) => sum + blob.size, 0) <= MAX_LOGO_SET_BYTES

const exportSide = async <TImage extends ImageSize>(
  tools: LogoTools<TImage>,
  image: TImage,
  crop: SquareCrop,
  side: number,
): Promise<Blob | null> => {
  const canvas = tools.createCanvas(side)
  canvas.drawSquare(image, crop)
  return await canvas.toPng()
}

// The four variants from one picked file, or the reason the file cannot be
// used. Nothing throws: the caller shows the reason.
export const generateLogoSet = async <TImage extends ImageSize>(
  file: File,
  tools: LogoTools<TImage>,
): Promise<LogoResult> => {
  const rejection = sourceRejection(file)
  if (rejection !== null) {
    return { ok: false, reason: rejection }
  }
  const image = await tools.decode(file)
  if (image === null) {
    return { ok: false, reason: 'decode' }
  }
  const crop = cropOf(image)
  if (crop.side < MIN_SOURCE_SIDE) {
    return { ok: false, reason: 'tooSmall' }
  }
  // One decoded source feeds all four exports, so they run together.
  const [master, logo1x, logo2x, logo3x] = await Promise.all([
    exportSide(tools, image, crop, LOGO_SIDE.master),
    exportSide(tools, image, crop, LOGO_SIDE.logo1x),
    exportSide(tools, image, crop, LOGO_SIDE.logo2x),
    exportSide(tools, image, crop, LOGO_SIDE.logo3x),
  ])
  if (master === null || logo1x === null || logo2x === null || logo3x === null) {
    return { ok: false, reason: 'encode' }
  }
  if (!withinCaps([master, logo1x, logo2x, logo3x])) {
    return { ok: false, reason: 'tooHeavy' }
  }
  return { ok: true, variants: { logo1x, logo2x, logo3x, master } }
}

// The browser's own decoder and canvas. The node test run injects fakes and
// never reaches this.
export const browserLogoTools: LogoTools<ImageBitmap> = {
  createCanvas: (side) => {
    const canvas = new OffscreenCanvas(side, side)
    const context = canvas.getContext('2d')
    return {
      drawSquare: (image, crop) => {
        if (context === null) {
          return
        }
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, side, side)
      },
      toPng: async () => (context === null ? null : await canvas.convertToBlob({ type: 'image/png' })),
    }
  },
  decode: async (file) => {
    try {
      return await createImageBitmap(file)
    } catch {
      return null
    }
  },
}

// What the form holds between a pick and a submit: the generated blobs with a
// preview of the master, or the reason the last file was refused.
export interface LogoPick {
  previewUrl: string
  variants: LogoSet
}

export interface LogoState {
  pick: LogoPick | null
  rejection: LogoRejection | null
}

export const EMPTY_LOGO: LogoState = { pick: null, rejection: null }

// A refused file clears the previous pick, so what the preview shows and what a
// submit would send are never two different images.
export const withLogoResult = (result: LogoResult, previewUrl: (blob: Blob) => string): LogoState =>
  result.ok
    ? { pick: { previewUrl: previewUrl(result.variants.master), variants: result.variants }, rejection: null }
    : { pick: null, rejection: result.reason }
