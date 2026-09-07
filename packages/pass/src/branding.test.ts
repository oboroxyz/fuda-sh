import { describe, expect, it } from 'vitest'

import { hexToRgb, luminance, rgbCss, textOn } from './branding.ts'

describe('pass branding colours', () => {
  it('parses a hex colour into rgb and back into Apple syntax', () => {
    expect(hexToRgb('#6F4320')).toStrictEqual({ b: 32, g: 67, r: 111 })
    expect(rgbCss(hexToRgb('#6F4320'))).toBe('rgb(111,67,32)')
  })

  it('picks white text on a dark brand and dark text on a light one', () => {
    expect(luminance(hexToRgb('#FFFFFF'))).toBeCloseTo(1)
    expect(textOn('#6F4320').text).toStrictEqual({ b: 255, g: 255, r: 255 })
    expect(textOn('#F5E9DA').text).toStrictEqual({ b: 20, g: 20, r: 20 })
  })
})
