// The first five colours match the site's OKLCH pass palette in sRGB #RRGGBB.
export const BRAND_SWATCHES = [
  { color: '#5CF794', name: 'mint' },
  { color: '#0073EB', name: 'steel' },
  { color: '#FFB635', name: 'apricot' },
  { color: '#FF909A', name: 'rose' },
  { color: '#C389FF', name: 'lilac' },
  { color: '#F5DB51', name: 'lemon' },
  { color: '#58D5F7', name: 'cyan' },
  { color: '#27C9AB', name: 'teal' },
  { color: '#FF795E', name: 'coral' },
  { color: '#2445A8', name: 'navy' },
  { color: '#783D91', name: 'plum' },
  { color: '#20242C', name: 'charcoal' },
] as const

export type BrandColorName = (typeof BRAND_SWATCHES)[number]['name']
export const DEFAULT_BRAND_COLOR = BRAND_SWATCHES[1].color
