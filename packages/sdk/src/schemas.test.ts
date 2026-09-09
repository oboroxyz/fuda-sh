import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

import { deriveIssueKind, IssuerCreateBody, IssueBody, RevokeBody, VerifyBody } from './schemas.ts'

const addr = `0x${'11'.repeat(20)}`
const uid = `0x${'ab'.repeat(32)}`
const meta = `0x${'cd'.repeat(66)}`

describe('IssueBody schema', () => {
  it('bearer: memberId only, defaults tier 0 and usageModel 1', () => {
    const out = v.parse(IssueBody, { memberId: 'alice' })
    expect(out).toStrictEqual({
      memberId: 'alice',
      metaURI: '',
      tier: 0,
      usageModel: 1,
      validFrom: 0,
      validUntil: 0,
    })
    expect(deriveIssueKind(out)).toBe('bearer')
  })

  it('signed: holder only', () => {
    expect(deriveIssueKind(v.parse(IssueBody, { holder: addr }))).toBe('signed')
  })

  it('private: stealthMetaAddress with optional memberId', () => {
    expect(deriveIssueKind(v.parse(IssueBody, { memberId: 'x', stealthMetaAddress: meta }))).toBe('private')
  })

  it('rejects holder + memberId, empty body, and holder + stealthMetaAddress', () => {
    expect(deriveIssueKind(v.parse(IssueBody, { holder: addr, memberId: 'a' }))).toBeNull()
    expect(deriveIssueKind(v.parse(IssueBody, {}))).toBeNull()
    expect(deriveIssueKind(v.parse(IssueBody, { holder: addr, stealthMetaAddress: meta }))).toBeNull()
  })

  it('rejects out-of-range tier / usageModel and empty memberId', () => {
    expect(v.safeParse(IssueBody, { memberId: 'a', tier: 4 }).success).toBe(false)
    expect(v.safeParse(IssueBody, { memberId: 'a', usageModel: 3 }).success).toBe(false)
    expect(v.safeParse(IssueBody, { memberId: '' }).success).toBe(false)
  })
})

describe('VerifyBody / RevokeBody', () => {
  it('accepts a fuda:v1 qr and a uid', () => {
    expect(v.safeParse(VerifyBody, { qr: `fuda:v1:${uid}` }).success).toBe(true)
    expect(v.safeParse(VerifyBody, { qr: uid }).success).toBe(false)
    expect(v.safeParse(RevokeBody, { uid }).success).toBe(true)
  })
})

describe('IssuerCreateBody schema', () => {
  it('accepts venue fields without requiring or returning card fields', () => {
    const out = v.parse(IssuerCreateBody, {
      brandColor: '#6f4320',
      handle: 'wassie-coffee',
      name: 'Wassie Coffee',
      tagline: 'Omotesando · Coffee shop',
    })

    expect(out).toStrictEqual({
      brandColor: '#6F4320',
      handle: 'wassie-coffee',
      logoUploadId: null,
      name: 'Wassie Coffee',
      tagline: 'Omotesando · Coffee shop',
    })
  })
})
