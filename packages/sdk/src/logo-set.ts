export interface ImageSetSpec {
  prefix: string
  variants: Readonly<Record<string, { width: number; height: number }>>
  maxObjectBytes: number
  maxSetBytes: number
  minSource: { width: number; height: number }
}

export const IMAGE_SETS = {
  artwork: {
    maxObjectBytes: 2 * 1024 * 1024,
    maxSetBytes: 4 * 1024 * 1024,
    minSource: { height: 432, width: 1125 },
    prefix: 'artwork',
    variants: {
      strip1x: { height: 144, width: 375 },
      strip2x: { height: 288, width: 750 },
      strip3x: { height: 432, width: 1125 },
    },
  },
  logo: {
    maxObjectBytes: 1024 * 1024,
    maxSetBytes: 2 * 1024 * 1024,
    minSource: { height: 660, width: 660 },
    prefix: 'logos',
    variants: {
      logo1x: { height: 50, width: 50 },
      logo2x: { height: 100, width: 100 },
      logo3x: { height: 150, width: 150 },
      master: { height: 1024, width: 1024 },
    },
  },
} as const satisfies Record<string, ImageSetSpec>

// The venue logo's wire contract, shared because the two sides of it are in
// different apps: the dashboard draws the four PNGs and names them as the
// multipart fields, and the api verifies the very same names, sides and caps
// before the set reaches R2. Workers have no image decoder, so this table is
// the only thing keeping producer and validator in agreement.
export const LOGO_VARIANTS = ['master', 'logo1x', 'logo2x', 'logo3x'] as const
export type LogoVariant = (typeof LOGO_VARIANTS)[number]

// `master` serves Google Wallet and every web surface; the three small ones are
// embedded in the .pkpass, sized for Apple's logo area at a square aspect.
export const LOGO_SIDE = {
  logo1x: IMAGE_SETS.logo.variants.logo1x.width,
  logo2x: IMAGE_SETS.logo.variants.logo2x.width,
  logo3x: IMAGE_SETS.logo.variants.logo3x.width,
  master: IMAGE_SETS.logo.variants.master.width,
} satisfies Record<LogoVariant, number>

export const MAX_LOGO_OBJECT_BYTES = IMAGE_SETS.logo.maxObjectBytes
export const MAX_LOGO_SET_BYTES = IMAGE_SETS.logo.maxSetBytes

export const isLogoVariant = (raw: string): raw is LogoVariant =>
  LOGO_VARIANTS.some((variant) => variant === raw)
