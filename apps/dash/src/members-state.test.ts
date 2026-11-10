import { describe, expect, it } from 'vitest'

import { countMembers, graphIsConfigured } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'

const UID = `0x${'ab'.repeat(32)}` as const

const rows: readonly MemberRowView[] = [
  {
    holder: `0x${'11'.repeat(20)}`,
    holderShort: '0x1111…1111',
    human: false,
    level: 'bearer',
    memberId: 'alice',
    passUrls: { apple: '/apple', google: '/google', web: '/web' },
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'GENERAL',
    uid: UID,
  },
  {
    holder: `0x${'22'.repeat(20)}`,
    holderShort: '0x2222…2222',
    human: false,
    level: 'signed',
    memberId: 'bob',
    passUrls: { apple: '/apple', google: '/google', web: '/web' },
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'VIP',
    uid: UID,
  },
  {
    holder: null,
    holderShort: null,
    human: false,
    level: 'signed',
    memberId: 'carol',
    passUrls: { apple: '/apple', google: '/google', web: '/web' },
    qr: `fuda:v1:${UID}`,
    status: 'revoked',
    tier: 'GENERAL',
    uid: UID,
  },
]

describe('member state', () => {
  it('counts active and revoked rows without counting another status', () => {
    expect(countMembers(rows)).toStrictEqual({ active: 2, revoked: 1, total: 3 })
  })

  it('considers a graph endpoint configured only when it contains non-whitespace text', () => {
    expect(graphIsConfigured('')).toBe(false)
    expect(graphIsConfigured('  ')).toBe(false)
    expect(graphIsConfigured('https://graph.example')).toBe(true)
  })
})
