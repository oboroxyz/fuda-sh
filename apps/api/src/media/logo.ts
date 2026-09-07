import { LOGO_SIDE, LOGO_VARIANTS, MAX_LOGO_OBJECT_BYTES, MAX_LOGO_SET_BYTES } from '@fuda/sdk'
import type { LogoVariant } from '@fuda/sdk'

// The variant set, its sides and its caps are the wire contract the dashboard
// draws against, so they live in @fuda/sdk; re-exported here because this
// module is where the api's logo rules otherwise live.
export { isLogoVariant, LOGO_SIDE, LOGO_VARIANTS, MAX_LOGO_OBJECT_BYTES, MAX_LOGO_SET_BYTES } from '@fuda/sdk'
export type { LogoVariant } from '@fuda/sdk'

export const LOGO_UPLOAD_TTL_SECONDS = 15 * 60

// A logo object never changes under its key, so both the stored metadata and a
// versioned response may be cached for a year.
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// A prefix this api wrote, and nothing else: the public route resolves it from
// the issuer row, but the shape is checked again before it reaches R2.
const PREFIX = /^logos\/[0-9a-f-]{36}$/u
export const isLogoPrefix = (raw: string): boolean => PREFIX.test(raw)

export const objectKey = (prefix: string, variant: LogoVariant): string => `${prefix}/${variant}.png`

// The version a public logo URL carries. The route is keyed by handle so a
// printed link keeps working, which means the URL alone cannot say which mark
// it is; the version restores that, and it is what makes a one-year immutable
// answer safe. Replacing a logo writes a new prefix, so the version changes.
export const logoVersion = (prefix: string): string => prefix.slice('logos/'.length)

export const logoUrlFor = (
  baseUrl: string,
  handle: string,
  prefix: string | null,
  variant: LogoVariant = 'master',
): string | null =>
  prefix === null
    ? null
    : `${baseUrl.replace(/\/$/u, '')}/assets/${handle}/logo/${variant}?v=${logoVersion(prefix)}`

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface PngHeader {
  width: number
  height: number
}

// PNG's first chunk is always IHDR, and its width and height are the two
// big-endian u32s right after the chunk type. Reading them needs no decoder,
// which is the whole reason the api can police what the browser produced.
export const readPngHeader = (bytes: Uint8Array): PngHeader | null => {
  if (bytes.length < 24 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(12) !== 0x49_48_44_52) {
    return null
  }
  return { height: view.getUint32(20), width: view.getUint32(16) }
}

export type LogoRejection = 'missing_variant' | 'not_png' | 'wrong_size' | 'too_large' | 'set_too_large'

export type LogoSetResult =
  | { ok: true; objects: { variant: LogoVariant; bytes: Uint8Array }[] }
  | { ok: false; reason: LogoRejection }

// Every variant present, every one a square PNG of its exact side, and the set
// within budget. Anything else is refused before a single object is written.
export const validateLogoSet = (parts: Map<string, Uint8Array>): LogoSetResult => {
  const objects: { variant: LogoVariant; bytes: Uint8Array }[] = []
  let total = 0
  for (const variant of LOGO_VARIANTS) {
    const bytes = parts.get(variant)
    if (bytes === undefined) {
      return { ok: false, reason: 'missing_variant' }
    }
    if (bytes.length > MAX_LOGO_OBJECT_BYTES) {
      return { ok: false, reason: 'too_large' }
    }
    const header = readPngHeader(bytes)
    if (header === null) {
      return { ok: false, reason: 'not_png' }
    }
    const side = LOGO_SIDE[variant]
    if (header.width !== side || header.height !== side) {
      return { ok: false, reason: 'wrong_size' }
    }
    total += bytes.length
    objects.push({ bytes, variant })
  }
  return total > MAX_LOGO_SET_BYTES ? { ok: false, reason: 'set_too_large' } : { objects, ok: true }
}
