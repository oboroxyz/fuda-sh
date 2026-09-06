import { encode } from 'uqr'

export interface QrSvgOptions {
  /** Rendered width/height in px; the viewBox stays in module units. Default 240. */
  modulePx?: number
  /** Quiet-zone modules around the symbol. Default 4 (the QR standard). */
  quiet?: number
}

// One <path> of unit squares over a white background; the QR is scanned from
// the contrast, so nothing here depends on fonts, images or external assets.
export const qrSvg = (text: string, opts: QrSvgOptions = {}): string => {
  const quiet = opts.quiet ?? 4
  const px = opts.modulePx ?? 240
  const { data, size } = encode(text)
  const side = size + quiet * 2
  const cells: string[] = []
  for (const [y, row] of data.entries()) {
    for (const [x, dark] of row.entries()) {
      if (dark) {
        cells.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${side}" height="${side}" fill="#fff"/>` +
    `<path d="${cells.join('')}" fill="#000"/>` +
    '</svg>'
  )
}
