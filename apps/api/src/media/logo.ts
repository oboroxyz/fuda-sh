// The variant set a venue logo is stored as. `master` serves Google Wallet and
// every web surface; the three small ones are embedded in the .pkpass, sized
// for Apple's logo area at a square aspect. Workers have no image decoder, so
// the dashboard draws these and the api verifies them
// (.superpowers/specs/2026-09-07-venue-logo-r2-design.md).
export const LOGO_VARIANTS = ['master', 'logo1x', 'logo2x', 'logo3x'] as const
export type LogoVariant = (typeof LOGO_VARIANTS)[number]

export const LOGO_SIDE = {
  logo1x: 50,
  logo2x: 100,
  logo3x: 150,
  master: 1024,
} satisfies Record<LogoVariant, number>

export const MAX_LOGO_OBJECT_BYTES = 1024 * 1024
export const MAX_LOGO_SET_BYTES = 2 * 1024 * 1024
export const LOGO_UPLOAD_TTL_SECONDS = 15 * 60

export const isLogoVariant = (raw: string): raw is LogoVariant =>
  LOGO_VARIANTS.some((variant) => variant === raw)

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
