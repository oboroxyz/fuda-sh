import { describe, expect, it } from 'vitest'

import {
  apiConnectionStatus,
  beginMembersLoad,
  completeMembersLoad,
  countMembers,
  failMembersLoad,
  graphIsConfigured,
  memberSnapshot,
} from './members-state.ts'
import type { MemberRowView } from './members-view.ts'

const UID = `0x${'ab'.repeat(32)}` as const

const rows: readonly MemberRowView[] = [
  {
    holderShort: '0x1111…1111',
    level: 'bearer',
    memberId: 'alice',
    passUrls: null,
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'GENERAL',
    uid: UID,
  },
  {
    holderShort: '0x2222…2222',
    level: 'signed',
    memberId: 'bob',
    passUrls: null,
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'VIP',
    uid: UID,
  },
  {
    holderShort: null,
    level: 'private',
    memberId: 'carol',
    passUrls: null,
    qr: `fuda:v1:${UID}`,
    status: 'revoked',
    tier: 'GENERAL',
    uid: UID,
  },
]

describe('member loading state', () => {
  it('counts active and revoked rows without counting another status', () => {
    expect(countMembers(rows)).toStrictEqual({ active: 2, revoked: 1, total: 3 })
  })

  it('starts an initial load without rows to retain', () => {
    expect(beginMembersLoad({ kind: 'idle' })).toStrictEqual({ kind: 'loading', previousRows: null })
  })

  it('exposes completed rows as a fresh snapshot', () => {
    expect(memberSnapshot(completeMembersLoad(rows))).toStrictEqual({ refreshing: false, rows, stale: false })
  })

  it('retains ready rows while a refresh is in progress', () => {
    const refreshing = beginMembersLoad(completeMembersLoad(rows))

    expect(memberSnapshot(refreshing)).toStrictEqual({ refreshing: true, rows, stale: false })
  })

  it('retains rows as stale when a refresh fails', () => {
    const refreshing = beginMembersLoad(completeMembersLoad(rows))

    expect(memberSnapshot(failMembersLoad(refreshing, 'fetch failed'))).toStrictEqual({
      refreshing: false,
      rows,
      stale: true,
    })
  })

  it('has no snapshot when an initial load fails', () => {
    expect(memberSnapshot(failMembersLoad({ kind: 'idle' }, 'fetch failed'))).toBeNull()
  })

  it('reports API availability from the members request state', () => {
    expect(apiConnectionStatus({ kind: 'idle' })).toBe('checking')
    expect(apiConnectionStatus(completeMembersLoad(rows))).toBe('connected')
    expect(apiConnectionStatus({ kind: 'error', message: 'down', previousRows: null })).toBe('unavailable')
  })

  it('considers a graph endpoint configured only when it contains non-whitespace text', () => {
    expect(graphIsConfigured('')).toBe(false)
    expect(graphIsConfigured('  ')).toBe(false)
    expect(graphIsConfigured('https://graph.example')).toBe(true)
  })
})
