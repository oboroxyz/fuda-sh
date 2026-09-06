import { describe, expect, it } from 'vitest'

import { memberRowView } from './members-view.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const HOLDER = `0x${'11'.repeat(20)}` as const
const API = 'https://api.fuda.sh'

describe(memberRowView, () => {
  it('shows a short holder, tier label and QR for a bearer row', () => {
    const v = memberRowView(
      {
        createdAt: 1,
        holder: HOLDER,
        level: 'bearer',
        memberId: 'alice',
        status: 'active',
        tier: 2,
        uid: UID,
      },
      API,
    )
    expect(v).toMatchObject({
      holder: HOLDER,
      holderShort: '0x1111…1111',
      memberId: 'alice',
      qr: `fuda:v1:${UID}`,
      tier: 'VIP',
    })
  })

  it('builds absolute pass links from the api base for a bearer row', () => {
    const v = memberRowView(
      {
        createdAt: 1,
        holder: HOLDER,
        level: 'bearer',
        memberId: 'alice',
        status: 'active',
        tier: 2,
        uid: UID,
      },
      API,
    )
    expect(v.passUrls).toStrictEqual({
      apple: `https://api.fuda.sh/pass/${UID}/apple.pkpass`,
      google: `https://api.fuda.sh/pass/${UID}/google`,
      web: `https://api.fuda.sh/pass/${UID}`,
    })
  })

  it('keeps the pass links for a signed row and labels an unknown tier', () => {
    const v = memberRowView(
      {
        createdAt: 1,
        holder: HOLDER,
        level: 'signed',
        memberId: 'bob',
        status: 'revoked',
        tier: 9,
        uid: UID,
      },
      API,
    )
    expect(v).toMatchObject({ status: 'revoked', tier: 'TIER 9' })
    expect(v.passUrls?.web).toBe(`https://api.fuda.sh/pass/${UID}`)
  })

  it('hides the holder and pass links for a private row but keeps memberId, uid and QR', () => {
    const v = memberRowView(
      { createdAt: 1, holder: null, level: 'private', memberId: '', status: 'active', tier: 0, uid: UID },
      API,
    )
    expect(v).toMatchObject({
      holder: null,
      holderShort: null,
      memberId: '',
      passUrls: null,
      qr: `fuda:v1:${UID}`,
      uid: UID,
    })
  })
})
