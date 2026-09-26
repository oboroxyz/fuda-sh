import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { readBadges, saveBadge } from '../src/badges/store.ts'
import { getDb } from '../src/db/client.ts'
import { badges } from '../src/db/schema.ts'

const db = () => getDb({ DB: env.DB })
const UID_A = `0x${'a1'.repeat(32)}` as const
const UID_B = `0x${'b2'.repeat(32)}` as const
const NOW = 1_759_000_000

const input = (uid: typeof UID_A, subjectKey: string) => ({
  credential: 'orb',
  expiresAt: null,
  kind: 'human' as const,
  scope: 'ethtokyo2026',
  subjectKey,
  uid,
  verifiedAt: NOW,
  verifier: 'world',
})

describe('badge store', () => {
  beforeEach(async () => {
    await db().delete(badges)
  })

  it('stores a badge and reads it back', async () => {
    const saved = await saveBadge(db(), input(UID_A, '0xdead'))
    expect(saved).toStrictEqual({ badge: { at: NOW, kind: 'human', verifier: 'world' }, ok: true })
    await expect(readBadges(db(), UID_A)).resolves.toStrictEqual([
      { at: NOW, kind: 'human', verifier: 'world' },
    ])
  })

  it('is idempotent for the same subject on the same right', async () => {
    await saveBadge(db(), input(UID_A, '0xdead'))
    const again = await saveBadge(db(), { ...input(UID_A, '0xdead'), verifiedAt: NOW + 60 })
    expect(again).toStrictEqual({ badge: { at: NOW, kind: 'human', verifier: 'world' }, ok: true })
  })

  it('rejects the same subject badging a second right', async () => {
    await saveBadge(db(), input(UID_A, '0xdead'))
    await expect(saveBadge(db(), input(UID_B, '0xdead'))).resolves.toStrictEqual({
      conflict: 'subject',
      ok: false,
    })
  })

  it('rejects a different subject on an already badged right', async () => {
    await saveBadge(db(), input(UID_A, '0xdead'))
    await expect(saveBadge(db(), input(UID_A, '0xbeef'))).resolves.toStrictEqual({
      conflict: 'pass',
      ok: false,
    })
  })

  it('reads an empty list for an unbadged right', async () => {
    await expect(readBadges(db(), UID_B)).resolves.toStrictEqual([])
  })
})
