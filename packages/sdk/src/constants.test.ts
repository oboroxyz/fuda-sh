import { describe, expect, it } from 'vitest'

import type { Hex } from './constants.ts'
import {
  asHex,
  isUid,
  LEVEL_CODE,
  levelFromCode,
  normalizeUid,
  parseQr,
  QR_RE,
  toQr,
  UID_RE,
} from './constants.ts'

// Annotated (not cast): a contextually-typed template literal already narrows to Hex.
const uid: Hex = `0x${'ab'.repeat(32)}`

describe('wire constants', () => {
  it('uid regex accepts 0x + 64 hex only', () => {
    expect(UID_RE.test(uid)).toBeTruthy()
    expect(UID_RE.test(uid.slice(0, -1))).toBeFalsy()
    expect(isUid('0x')).toBeFalsy()
  })

  it('QR round-trips through fuda:v1:', () => {
    expect(toQr(uid)).toBe(`fuda:v1:${uid}`)
    expect(parseQr(`fuda:v1:${uid}`)).toBe(uid)
    expect(parseQr(`fuda:v2:${uid}`)).toBeNull()
    expect(QR_RE.test(`fuda:v1:${uid}`)).toBeTruthy()
  })

  it('normalizes a valid uid to lower case and rejects anything else', () => {
    const upper = `0x${'ab'.repeat(32).toUpperCase()}`
    expect(normalizeUid(upper)).toBe(uid)
    expect(normalizeUid(uid)).toBe(uid)
    expect(normalizeUid('0x')).toBeNull()
    expect(normalizeUid(upper.toUpperCase())).toBeNull()
  })

  it('parses an upper-case QR payload down to the canonical uid', () => {
    expect(parseQr(`fuda:v1:0x${'ab'.repeat(32).toUpperCase()}`)).toBe(uid)
  })

  it('level codes are 0/1/2 and invert', () => {
    expect(LEVEL_CODE).toStrictEqual({ bearer: 0, private: 2, signed: 1 })
    expect(levelFromCode(1)).toBe('signed')
    expect(levelFromCode(3)).toBeNull()
  })
})

describe(asHex, () => {
  it('accepts exactly the requested byte length', () => {
    expect(asHex(`0x${'ab'.repeat(20)}`, 20)).toBe(`0x${'ab'.repeat(20)}`)
    expect(asHex(`0x${'AB'.repeat(32)}`, 32)).toBe(`0x${'AB'.repeat(32)}`)
  })

  it('rejects the wrong length, a missing prefix and non-hex', () => {
    expect(asHex(`0x${'ab'.repeat(19)}`, 20)).toBeNull()
    expect(asHex('ab'.repeat(20), 20)).toBeNull()
    expect(asHex(`0x${'zz'.repeat(20)}`, 20)).toBeNull()
  })
})
