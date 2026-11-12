import { IMAGE_SETS } from '@fuda/sdk'
import type { ImageSetSpec, LogoVariant } from '@fuda/sdk'

// The venue's logo, drawn here rather than in the api: Workers have no image
// decoder, so the browser produces the four square PNGs and the api verifies
// them (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
// The canvas and the decoder are injected, so the whole pipeline runs in the
// node test run against fakes.

// The variant names, sides and caps are the api's contract, not this form's:
// they come from @fuda/sdk so a doomed upload is explained in the form instead
// of coming back as a bare 400.
export { LOGO_SIDE, LOGO_VARIANTS, MAX_LOGO_OBJECT_BYTES } from '@fuda/sdk'
export type { LogoVariant } from '@fuda/sdk'

const BYTES_PER_MIB = 1024 * 1024

export const MAX_SOURCE_BYTES = 10 * BYTES_PER_MIB

const SOURCE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

// What a file input should offer; the pipeline rejects anything else anyway.
export const SOURCE_ACCEPT = SOURCE_TYPES.join(',')

export type LogoSet = Record<LogoVariant, Blob>

// Why the pipeline refused a file, in the terms the form explains it.
export type LogoRejection = 'decode' | 'encode' | 'tooHeavy' | 'tooLarge' | 'tooSmall' | 'type'

export type LogoResult = { ok: true; variants: LogoSet } | { ok: false; reason: LogoRejection }

export interface ImageSize {
  close?: () => void
  height: number
  width: number
}

// The region drawn from the source, in source pixels.
export interface ImageCrop {
  width: number
  height: number
  x: number
  y: number
}

export interface ImageCanvas<TImage> {
  drawCrop: (image: TImage, crop: ImageCrop) => void
  // null when the drawing surface was unavailable, which is an `encode` refusal
  // rather than a thrown error.
  toPng: () => Promise<Blob | null>
}

export interface ImageTools<TImage extends ImageSize> {
  createCanvas: (width: number, height: number) => ImageCanvas<TImage>
  decode: (file: File) => Promise<TImage | null>
}

// Centre-crop to the set aspect without changing the image proportions.
export const cropOf = ({ height, width }: ImageSize, aspect = 1): ImageCrop => {
  const cropWidth = Math.min(width, height * aspect)
  const cropHeight = cropWidth / aspect
  return {
    height: cropHeight,
    width: cropWidth,
    x: Math.floor((width - cropWidth) / 2),
    y: Math.floor((height - cropHeight) / 2),
  }
}

const isSourceType = (type: string): boolean => SOURCE_TYPES.some((accepted) => accepted === type)

// What is knowable before a byte is decoded.
const sourceRejection = (file: File): LogoRejection | null => {
  if (!isSourceType(file.type)) {
    return 'type'
  }
  return file.size > MAX_SOURCE_BYTES ? 'tooLarge' : null
}

export const generateImageSet = async <TImage extends ImageSize>(
  file: File,
  tools: ImageTools<TImage>,
  spec: ImageSetSpec,
): Promise<{ ok: true; variants: Record<string, Blob> } | { ok: false; reason: LogoRejection }> => {
  const rejection = sourceRejection(file)
  if (rejection !== null) {
    return { ok: false, reason: rejection }
  }
  let image: TImage | null
  try {
    image = await tools.decode(file)
  } catch {
    return { ok: false, reason: 'decode' }
  }
  if (image === null) {
    return { ok: false, reason: 'decode' }
  }
  try {
    const crop = cropOf(image, spec.minSource.width / spec.minSource.height)
    if (crop.width < spec.minSource.width || crop.height < spec.minSource.height) {
      return { ok: false, reason: 'tooSmall' }
    }
    const variants: Record<string, Blob> = {}
    for (const [variant, size] of Object.entries(spec.variants)) {
      const canvas = tools.createCanvas(size.width, size.height)
      canvas.drawCrop(image, crop)
      // oxlint-disable-next-line no-await-in-loop -- export one canvas at a time to bound image memory
      const blob = await canvas.toPng()
      if (blob === null) {
        return { ok: false, reason: 'encode' }
      }
      variants[variant] = blob
    }
    const blobs = Object.values(variants)
    if (
      blobs.some((blob) => blob.size > spec.maxObjectBytes) ||
      blobs.reduce((sum, blob) => sum + blob.size, 0) > spec.maxSetBytes
    ) {
      return { ok: false, reason: 'tooHeavy' }
    }
    return { ok: true, variants }
  } catch {
    return { ok: false, reason: 'encode' }
  } finally {
    image.close?.()
  }
}

export const generateLogoSet = async <TImage extends ImageSize>(
  file: File,
  tools: ImageTools<TImage>,
): Promise<LogoResult> => {
  const result = await generateImageSet(file, tools, IMAGE_SETS.logo)
  if (!result.ok) {
    return result
  }
  const { master, logo1x, logo2x, logo3x } = result.variants
  if (master === undefined || logo1x === undefined || logo2x === undefined || logo3x === undefined) {
    return { ok: false, reason: 'encode' }
  }
  return { ok: true, variants: { logo1x, logo2x, logo3x, master } }
}

// The browser's own decoder and canvas. The node test run injects fakes and
// never reaches this.
export const browserImageTools: ImageTools<ImageBitmap> = {
  createCanvas: (width, height) => {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    return {
      drawCrop: (image, crop) => {
        if (context === null) {
          return
        }
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
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
