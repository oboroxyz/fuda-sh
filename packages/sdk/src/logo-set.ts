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
  logo1x: 50,
  logo2x: 100,
  logo3x: 150,
  master: 1024,
} satisfies Record<LogoVariant, number>

const BYTES_PER_MIB = 1024 * 1024

export const MAX_LOGO_OBJECT_BYTES = BYTES_PER_MIB
export const MAX_LOGO_SET_BYTES = 2 * BYTES_PER_MIB

export const isLogoVariant = (raw: string): raw is LogoVariant =>
  LOGO_VARIANTS.some((variant) => variant === raw)
