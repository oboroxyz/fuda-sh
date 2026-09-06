import { describe, expect, it } from 'vitest'

import {
  decodeAttendanceV1,
  decodeDelegation,
  decodeEntitlement,
  decodeEntitlementV1,
  encodeAttendanceV1,
  encodeDelegationV1,
  encodeEntitlementV1,
  toCanonical,
} from './codecs.ts'

const holder = `0x${'11'.repeat(20)}` as const
const issuer = `0x${'22'.repeat(20)}` as const
const zero32 = `0x${'00'.repeat(32)}` as const

describe(encodeEntitlementV1, () => {
  const e = {
    holder,
    issuer,
    level: 1,
    metaURI: 'ipfs://x',
    serial: zero32,
    tier: 2,
    usageModel: 1,
    validFrom: 0n,
    validUntil: 1_800_000_000n,
  } as const

  it('round-trips v1 including level', () => {
    const data = encodeEntitlementV1(e)
    expect(decodeEntitlementV1(data)).toStrictEqual(e)
  })

  it('v1 → canonical upcast is the identity plus schemaVersion', () => {
    expect(toCanonical(decodeEntitlementV1(encodeEntitlementV1(e)))).toStrictEqual({ ...e, schemaVersion: 1 })
    expect(decodeEntitlement(1, encodeEntitlementV1(e)).schemaVersion).toBe(1)
    expect(() => decodeEntitlement(9, encodeEntitlementV1(e))).toThrow(/./u)
  })
})

describe(encodeDelegationV1, () => {
  it('round-trip', () => {
    const d = { active: true, issuer, name: 'fuda root' }
    expect(decodeDelegation(1, encodeDelegationV1(d))).toStrictEqual({ ...d, schemaVersion: 1 })
    const a = { enteredAt: 1_757_000_000n, holder, rightUID: `0x${'ab'.repeat(32)}` as const, slotId: zero32 }
    expect(decodeAttendanceV1(encodeAttendanceV1(a))).toStrictEqual(a)
  })
})
