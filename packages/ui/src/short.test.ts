import { describe, expect, it } from 'vitest'

import { short } from './short.ts'

describe(short, () => {
  it('keeps the 0x prefix and the last four characters of an address', () => {
    expect(short(`0x${'11'.repeat(20)}`)).toBe('0x1111…1111')
  })

  it('leaves a string shorter than the elision untouched apart from the ellipsis', () => {
    expect(short('0xabcd')).toBe('0xabcd…abcd')
  })
})
