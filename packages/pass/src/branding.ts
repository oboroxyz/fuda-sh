import { brandTextColor, hexToRgb } from '@fuda/sdk'
import type { Rgb } from '@fuda/sdk'

export { hexToRgb, luminance, rgbCss } from '@fuda/sdk'
export type { Rgb } from '@fuda/sdk'

// What a venue's card adds to a pass (docs/specs/pass-types-and-flows.md#passes):
// absent for admin-issued rights, which keep the plain fuda look.
export interface PassBranding {
  // the venue name: Apple organizationName, Google cardTitle
  issuerName: string
  // the card title: Apple description, Google header
  cardTitle: string
  // `#RRGGBB`
  brandColor: string
  // the member number in display form (`QJ2Y-XPHE-PDRKA`)
  memberNumber: string
  // set when the card asks to surface near the venue (Apple `locations`)
  venue: { lat: number; lng: number } | null
  // the venue's mark as a public URL, or null when it has none. Google and the
  // web pass link to it; the Apple builder is handed the bytes separately,
  // because a .pkpass embeds its images rather than fetching them.
  logoUrl: string | null
}

interface PassTextColors {
  text: Rgb
  label: Rgb
}

export const textOn = (hex: string): PassTextColors => {
  const text = hexToRgb(brandTextColor(hex))
  return { label: text, text }
}
