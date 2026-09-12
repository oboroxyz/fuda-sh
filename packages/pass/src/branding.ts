import { brandTextColor, hexToRgb } from '@fuda/sdk'
import type { CardCategory, Rgb } from '@fuda/sdk'

export { hexToRgb, luminance, rgbCss } from '@fuda/sdk'
export type { Rgb } from '@fuda/sdk'

// What a venue's card adds to a pass (docs/specs/pass-types-and-flows.md#passes):
// absent for admin-issued rights, which keep the plain fuda look.
export interface PassBranding {
  // the venue name: Apple organizationName, Google cardTitle
  issuerName: string
  // the card title: Apple description, Google header
  cardTitle: string
  // membership or ticket: decides how the member number is labelled
  category: CardCategory
  // when the right was issued, unix seconds (members.created_at)
  issuedAt: number
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

// The label over the member number, as the venue card page prints it.
export const roleLabel = (category: CardCategory): string => (category === 'ticket' ? 'TICKET' : 'MEMBER')

// `2026-09-12T00:00:00Z`: the issue day as Wallet's date fields want it, on the
// UTC calendar the web pass also uses, so both show the same day.
export const issuedDayIso = (unixSeconds: number): string =>
  `${new Date(unixSeconds * 1000).toISOString().slice(0, 10)}T00:00:00Z`

// `Sep 12, 2026`: the same day as plain text, for a pass whose fields Wallet
// does not format (Google text modules). English, as the module labels are.
const ISSUED_DAY = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })
export const issuedDayText = (unixSeconds: number): string => ISSUED_DAY.format(new Date(unixSeconds * 1000))

interface PassTextColors {
  text: Rgb
  label: Rgb
}

export const textOn = (hex: string): PassTextColors => {
  const text = hexToRgb(brandTextColor(hex))
  return { label: text, text }
}
