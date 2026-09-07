import { describe, expect, it } from 'vitest'

import {
  formatMemberNumber,
  generateMemberNumber,
  isMemberNumber,
  MEMBER_NUMBER_ALPHABET,
  MEMBER_NUMBER_LENGTH,
} from './member-number.ts'

describe('member numbers', () => {
  it('validates the documented example and rejects a wrong check character', () => {
    expect(isMemberNumber('qj2yxphepdrka')).toBe(true)
    expect(isMemberNumber('qj2yxphepdrkb')).toBe(false)
    expect(isMemberNumber('qj2yxphepdrk')).toBe(false)
  })

  it('generates numbers that validate and use only the alphabet', () => {
    const generated = Array.from({ length: 50 }, () => generateMemberNumber())
    expect(generated.every(isMemberNumber)).toBe(true)
    expect(generated.every((n) => n.length === MEMBER_NUMBER_LENGTH)).toBe(true)
    expect(generated.every((n) => new RegExp(`^[${MEMBER_NUMBER_ALPHABET}]+$`, 'u').test(n))).toBe(true)
    expect(new Set(generated).size).toBe(50)
  })

  it('discards bytes above the unbiased limit and keeps drawing', () => {
    let calls = 0
    const number = generateMemberNumber((length) => {
      calls += 1
      // First draw: every byte is 255 (out of range); second draw: zeros.
      return new Uint8Array(length).fill(calls === 1 ? 255 : 0)
    })
    expect(calls).toBe(2)
    expect(number.slice(0, -1)).toBe('2'.repeat(12))
    expect(isMemberNumber(number)).toBe(true)
  })

  it('formats as upper-cased 4-4-5 and leaves other ids alone', () => {
    expect(formatMemberNumber('qj2yxphepdrka')).toBe('QJ2Y-XPHE-PDRKA')
    expect(formatMemberNumber('alice')).toBe('alice')
  })
})
