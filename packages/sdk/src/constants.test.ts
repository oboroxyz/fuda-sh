import { describe, expect, it } from 'vitest'

import { isUid, LEVEL_CODE, levelFromCode, parseQr, QR_RE, toQr, UID_RE } from './constants.ts'

const uid = `0x${'ab'.repeat(32)}`

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

  it('level codes are 0/1/2 and invert', () => {
    expect(LEVEL_CODE).toStrictEqual({ bearer: 0, private: 2, signed: 1 })
    expect(levelFromCode(1)).toBe('signed')
    expect(levelFromCode(3)).toBeNull()
  })
})
