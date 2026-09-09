export interface Rgb {
  r: number
  g: number
  b: number
}

// Brand colours are validated as #RRGGBB at the API boundary.
export const hexToRgb = (hex: string): Rgb => ({
  b: Number.parseInt(hex.slice(5, 7), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  r: Number.parseInt(hex.slice(1, 3), 16),
})

export const rgbCss = ({ r, g, b }: Rgb): string => `rgb(${r},${g},${b})`

const linearChannel = (channel: number): number => {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export const luminance = ({ r, g, b }: Rgb): number =>
  0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b)

// Pick whichever of pure black and white has the higher WCAG contrast ratio.
export const brandTextColor = (hex: string): '#000000' | '#FFFFFF' => {
  const background = luminance(hexToRgb(hex))
  const blackContrast = (background + 0.05) / 0.05
  const whiteContrast = 1.05 / (background + 0.05)
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF'
}
