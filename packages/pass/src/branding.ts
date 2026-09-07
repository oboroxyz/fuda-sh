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
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export const hexToRgb = (hex: string): Rgb => ({
  b: Number.parseInt(hex.slice(5, 7), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  r: Number.parseInt(hex.slice(1, 3), 16),
})

// Apple's colour syntax.
export const rgbCss = ({ r, g, b }: Rgb): string => `rgb(${r},${g},${b})`

// WCAG relative luminance, enough to pick white or near-black text on a brand colour.
const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export const luminance = ({ r, g, b }: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

export const textOn = (hex: string): { text: Rgb; label: Rgb } =>
  luminance(hexToRgb(hex)) > 0.4
    ? { label: { b: 40, g: 40, r: 40 }, text: { b: 20, g: 20, r: 20 } }
    : { label: { b: 230, g: 230, r: 230 }, text: { b: 255, g: 255, r: 255 } }
