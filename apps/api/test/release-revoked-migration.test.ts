import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { badges, cards, issuers, members } from '../src/db/schema.ts'

const NOW = 1_800_000_000
const db = () => getDb({ DB: env.DB })

const migration = () => {
  const found = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0036_'))
  if (found === undefined) {
    throw new Error('migration 0036 is missing')
  }
  return found
}

const member = (uid: string, cardId: string, issuerId: string, status: 'active' | 'revoked') => ({
  attestationUid: uid,
  cardId,
  createdAt: NOW,
  holder: `0x${'aa'.repeat(20)}`,
  issuerId,
  level: 'bearer' as const,
  memberId: uid,
  status,
})

const badge = (uid: string, subjectKey: string) => ({
  credential: 'proof-free',
  kind: 'human',
  scope: 'scope',
  subjectKey,
  uid,
  verifiedAt: NOW,
  verifier: 'world',
})

describe('migration 0036, releasing Rights revoked before the release rule', () => {
  beforeEach(async () => {
    await db().delete(badges)
    await db().delete(members)
    await db().delete(cards)
    await db().delete(issuers)
  })

  it('returns their places and deletes their badges, leaving live and in-flight places alone', async () => {
    const issuerId = crypto.randomUUID()
    await db()
      .insert(issuers)
      .values({
        brandColor: '#112233',
        createdAt: NOW,
        handle: 'backfill',
        id: issuerId,
        name: 'Backfill',
        operatorAddress: `0x${'cc'.repeat(20)}`,
        tagline: '',
      })
    const card = { category: 'membership' as const, createdAt: NOW, issuerId, title: 'Card' }
    // Three places: one revoked Right, one live Right, one issuance still in flight.
    await db()
      .insert(cards)
      .values([
        { ...card, capacity: 3, id: 'held', reserved: 3, slug: 'held' },
        { ...card, id: 'drained', reserved: 0, slug: 'drained' },
      ])
    await db()
      .insert(members)
      .values([
        member('0xrevoked', 'held', issuerId, 'revoked'),
        member('0xlive', 'held', issuerId, 'active'),
        member('0xold', 'drained', issuerId, 'revoked'),
      ])
    await db()
      .insert(badges)
      .values([badge('0xrevoked', 'person-a'), badge('0xlive', 'person-b')])

    await env.DB.batch(migration().queries.map((query) => env.DB.prepare(query)))

    const reserved = await db()
      .select({ id: cards.id, reserved: cards.reserved })
      .from(cards)
      .orderBy(cards.id)
    expect(reserved).toStrictEqual([
      { id: 'drained', reserved: 0 },
      { id: 'held', reserved: 2 },
    ])
    await expect(db().select({ uid: badges.uid }).from(badges)).resolves.toStrictEqual([{ uid: '0xlive' }])
  })
})
