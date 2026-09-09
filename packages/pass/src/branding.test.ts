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
    expect(textOn('#F5E9DA').text).toStrictEqual({ b: 0, g: 0, r: 0 })
  })

  it.each([
    ['#5CF794', 0],
    ['#0073EB', 0],
    ['#FFB635', 0],
    ['#FF909A', 0],
    ['#C389FF', 0],
    ['#777777', 0],
    ['#757575', 255],
    ['#20242C', 255],
    ['#2445A8', 255],
    ['#783D91', 255],
  ])('chooses the higher-contrast text and labels on %s', (color, channel) => {
    const expected = { b: channel, g: channel, r: channel }
    expect(textOn(color)).toStrictEqual({ label: expected, text: expected })
    const background = luminance(hexToRgb(color))
    const foreground = luminance(expected)
    const contrast = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
    expect(contrast).toBeGreaterThanOrEqual(4.5)
  })
})
