import { describe, expect, it } from 'vitest'

import { passPlatform } from './pass-platform.ts'

describe(passPlatform, () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'apple',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'apple',
    ],
    ['Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) Mobile/15E148', 'apple'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148', 'apple'],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
      'google',
    ],
    ['Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'google'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      'web',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'web'],
    ['', 'web'],
    ['unrecognized client', 'web'],
  ])('selects the pass destination for %s', (userAgent, expected) => {
    expect(passPlatform(userAgent)).toBe(expected)
  })
})
