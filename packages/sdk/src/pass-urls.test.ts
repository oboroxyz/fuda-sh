import { describe, expect, it } from 'vitest'

import type { Hex } from './constants.ts'
import { passUrls } from './pass-urls.ts'

const uid: Hex = `0x${'ab'.repeat(32)}`

describe(passUrls, () => {
  it('builds all three absolute urls', () => {
    expect(passUrls('https://api.fuda.sh', uid)).toStrictEqual({
      apple: `https://api.fuda.sh/pass/${uid}/apple.pkpass`,
      google: `https://api.fuda.sh/pass/${uid}/google`,
      web: `https://api.fuda.sh/pass/${uid}`,
    })
  })

  it('strips a trailing slash from the base url', () => {
    expect(passUrls('https://api.fuda.sh/', uid).web).toBe(`https://api.fuda.sh/pass/${uid}`)
  })

  it('always has exactly the three keys apple, google and web', () => {
    expect(Object.keys(passUrls('https://api.fuda.sh', uid)).toSorted()).toStrictEqual([
      'apple',
      'google',
      'web',
    ])
  })
})
