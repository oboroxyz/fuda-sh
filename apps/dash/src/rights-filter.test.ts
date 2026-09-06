import { describe, expect, it } from 'vitest'

import type { MemberRowView } from './members-view.ts'
import { DEFAULT_RIGHTS_FILTERS, filterRights, hasRightsFilters } from './rights-filter.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const HOLDER = `0x${'11'.repeat(20)}` as const

const rows: readonly MemberRowView[] = [
  {
    holder: HOLDER,
    holderShort: '0x1111…1111',
    level: 'bearer',
    memberId: 'alice',
    passUrls: null,
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'VIP',
    uid: UID,
  },
  {
    holder: `0x${'22'.repeat(20)}`,
    holderShort: '0x2222…2222',
    level: 'signed',
    memberId: 'bob',
    passUrls: null,
    qr: `fuda:v1:0x${'cd'.repeat(32)}`,
    status: 'revoked',
    tier: 'GENERAL',
    uid: `0x${'cd'.repeat(32)}`,
  },
  {
    holder: null,
    holderShort: null,
    level: 'private',
    memberId: 'carol',
    passUrls: null,
    qr: `fuda:v1:0x${'ef'.repeat(32)}`,
    status: 'active',
    tier: 'GENERAL',
    uid: `0x${'ef'.repeat(32)}`,
  },
]

describe(filterRights, () => {
  it('matches a member ID without regard to case', () => {
    expect(
      filterRights(rows, { level: 'all', query: 'ALICE', status: 'all' }).map(({ memberId }) => memberId),
    ).toStrictEqual(['alice'])
  })

  it('matches the complete holder and a UID fragment without regard to case', () => {
    expect(filterRights(rows, { level: 'all', query: HOLDER.toUpperCase(), status: 'all' })).toHaveLength(1)
    expect(filterRights(rows, { level: 'all', query: UID.slice(12, 28), status: 'all' })).toHaveLength(1)
  })

  it('applies level and status constraints together', () => {
    expect(
      filterRights(rows, { level: 'private', query: '', status: 'active' }).map(({ level }) => level),
    ).toStrictEqual(['private'])
  })
})

describe(hasRightsFilters, () => {
  it('only reports a non-default filter state', () => {
    expect(hasRightsFilters(DEFAULT_RIGHTS_FILTERS)).toBe(false)
    expect(hasRightsFilters({ ...DEFAULT_RIGHTS_FILTERS, status: 'revoked' })).toBe(true)
  })
})
