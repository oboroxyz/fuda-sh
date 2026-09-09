import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

import {
  CardBody,
  CardUpdateBody,
  deriveIssueKind,
  IssuerCreateBody,
  IssueBody,
  RevokeBody,
  VerifyBody,
} from './schemas.ts'

const addr = `0x${'11'.repeat(20)}`
const uid = `0x${'ab'.repeat(32)}`
const meta = `0x${'cd'.repeat(66)}`

describe('Card description', () => {
  const card = { category: 'membership', slug: 'coffee', title: 'Coffee' }

  it('preserves multiline text and trims only the surrounding whitespace', () => {
    const out = v.parse(CardBody, { ...card, description: '  First line\nSecond line  ' })
    expect(out).toMatchObject({ description: 'First line\nSecond line' })
    expect(out).not.toHaveProperty('perk')
    expect(out).not.toHaveProperty('reward')
  })

  it('defaults an omitted description to empty text', () => {
    expect(v.parse(CardBody, card)).toHaveProperty('description', '')
  })

  it.each([
    { length: 2000, valid: true },
    { length: 2001, valid: false },
  ])('accepts description length $length: $valid', ({ length, valid }) => {
    expect(v.safeParse(CardBody, { ...card, description: 'a'.repeat(length) }).success).toBe(valid)
  })
})

describe('CardUpdateBody schema', () => {
  const update = {
    category: 'membership',
    claimFrom: null,
    claimUntil: null,
    description: '  Updated membership  ',
    lockScreen: true,
    title: ' Updated Card ',
    validFrom: null,
    validUntil: null,
    validityDays: 30,
    venue: { lat: 35.6762, lng: 139.6503 },
  }

  it('normalizes the complete editable card state without a slug', () => {
    expect(v.parse(CardUpdateBody, update)).toStrictEqual({
      ...update,
      description: 'Updated membership',
      title: 'Updated Card',
    })
  })

  it.each(['slug', 'issuerId'])('rejects immutable or tenant-controlled field %s', (field) => {
    expect(v.safeParse(CardUpdateBody, { ...update, [field]: 'forbidden' }).success).toBe(false)
  })

  it('rejects a partial replacement that omits editable state', () => {
    const { validityDays: _validityDays, ...partial } = update
    expect(v.safeParse(CardUpdateBody, partial).success).toBe(false)
  })

  it('accepts an omitted venue as an instruction to clear coordinates', () => {
    const { venue: _venue, ...withoutVenue } = update
    expect(v.parse(CardUpdateBody, withoutVenue)).not.toHaveProperty('venue')
  })

  it('uses the create rules for coordinates and validity windows', () => {
    expect(v.safeParse(CardUpdateBody, { ...update, venue: { lat: 91, lng: 0 } }).success).toBe(false)
    expect(
      v.safeParse(CardUpdateBody, {
        ...update,
        validFrom: 1,
        validUntil: 2,
        validityDays: 30,
      }).success,
    ).toBe(false)
  })
})

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
  it.each(['ab--cd', 'xn--coffee', '12--34'])('rejects an ENS-invalid handle %s', (handle) => {
    expect(v.safeParse(IssuerCreateBody, { brandColor: '#6F4320', handle, name: 'Coffee' }).success).toBe(
      false,
    )
  })

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
