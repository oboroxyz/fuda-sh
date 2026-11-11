import { normalizeUid } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeChain } from '../../test/env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from '../../test/fixtures.ts'
import { saveBadge, readBadges } from '../badges/store.ts'
import { getDb } from '../db/client.ts'
import { badges, cards, issuers, members, offchainAttestations, slots } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { revokePass } from '../passes/revoke-pass.ts'
import { requestContext } from '../request.ts'
import { issueForCard } from './issue-for-card.ts'

const rightUid = (uid: string) => {
  const normalized = normalizeUid(uid)
  if (normalized === null) {
    throw new Error('invalid Right UID')
  }
  return normalized
}

const issuedUid = async (db: ReturnType<typeof getDb>) => {
  const rows = await db.select().from(members)
  const active = rows.find((row) => row.status === 'active')
  if (active === undefined) {
    throw new Error('missing issued Right')
  }
  return rightUid(active.attestationUid)
}

const setup = async (record: 'onchain' | 'offchain' = 'onchain') => {
  const db = getDb({ DB: env.DB })
  const issuer = { handle: 'receipt-test', id: 'receipt-test' }
  await db.insert(issuers).values({
    ...issuer,
    brandColor: '#000000',
    createdAt: NOW,
    name: 'Receipt test',
    operatorAddress: ROOT,
  })
  const card = await db
    .insert(cards)
    .values({
      capacity: 1,
      category: 'ticket',
      createdAt: NOW,
      id: 'receipt-card',
      issuerId: issuer.id,
      record,
      title: 'One place',
    })
    .returning()
    .get()
  const chain = fakeChain({ signer: ROOT })
  const bindings = configuredEnv(seedRoot(chain))
  const app = new Hono<AppEnv>()
  app.use('*', requestContext({ chain, now: () => NOW }))
  app.post('/', async (c) => c.json(await issueForCard(c, card, issuer, null)))
  app.post('/revoke/:uid', async (c) =>
    c.json(await revokePass(c, rightUid(c.req.param('uid')), { kind: 'admin' })),
  )
  const revoke = async (uid: string) => {
    const response = await app.request(`/revoke/${uid}`, { method: 'POST' }, bindings)
    return await response.json()
  }
  const issue = async () => {
    const response = await app.request('/', { method: 'POST' }, bindings)
    return await response.json()
  }
  return { chain, db, issue, revoke }
}

describe(issueForCard, () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(badges)
    await db.delete(offchainAttestations)
    await db.delete(slots)
    await db.delete(members)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it.each(['onchain', 'offchain'] as const)(
    'returns a %s place exactly once across concurrent retries',
    async (record) => {
      const { db, issue, revoke } = await setup(record)
      await issue()
      const uid = await issuedUid(db)
      await expect(issue()).resolves.toStrictEqual({ error: 'card_sold_out', ok: false })
      await expect(revoke(uid)).resolves.toStrictEqual({ ok: true })
      await expect(issue()).resolves.toMatchObject({ ok: true })
      await expect(Promise.all([revoke(uid), revoke(uid)])).resolves.toStrictEqual([
        { ok: true },
        { ok: true },
      ])
      await expect(db.select({ reserved: cards.reserved }).from(cards)).resolves.toStrictEqual([
        { reserved: 1 },
      ])
    },
  )

  it.each(['onchain', 'offchain'] as const)(
    'releases a %s badge for the same human after re-issue',
    async (record) => {
      const { db, issue, revoke } = await setup(record)
      await issue()
      const uid = await issuedUid(db)
      const badge = {
        credential: 'orb',
        expiresAt: null,
        kind: 'human' as const,
        scope: 'receipt-card',
        subjectKey: 'scoped-person',
        uid,
        verifiedAt: NOW,
        verifier: 'world',
      }
      await expect(saveBadge(db, badge)).resolves.toMatchObject({ ok: true })
      await revoke(uid)
      await expect(readBadges(db, uid)).resolves.toStrictEqual([])
      await expect(saveBadge(db, badge)).resolves.toStrictEqual({ conflict: 'revoked', ok: false })
      await issue()
      const successor = await issuedUid(db)
      await expect(saveBadge(db, { ...badge, uid: successor })).resolves.toMatchObject({ ok: true })
      await expect(saveBadge(db, { ...badge, uid: rightUid(`0x${'ee'.repeat(32)}`) })).resolves.toStrictEqual(
        { conflict: 'subject', ok: false },
      )
    },
  )

  it('keeps a consumed place until revoke and never releases below zero', async () => {
    const { db, issue, revoke } = await setup()
    await issue()
    const uid = await issuedUid(db)
    await db.insert(slots).values({ consumedAt: NOW, slot: 'default', uid })
    await expect(issue()).resolves.toStrictEqual({ error: 'card_sold_out', ok: false })
    await expect(revoke(uid)).resolves.toStrictEqual({ ok: true })
    await expect(db.select({ reserved: cards.reserved }).from(cards)).resolves.toStrictEqual([
      { reserved: 0 },
    ])
    await revoke(uid)
    await expect(db.select({ reserved: cards.reserved }).from(cards)).resolves.toStrictEqual([
      { reserved: 0 },
    ])
    await expect(issue()).resolves.toMatchObject({ ok: true })
  })

  it('keeps the place and logs the tx hash when a broadcast attest has no receipt', async () => {
    const { chain, db, issue } = await setup()
    chain.unknownAttestOutcome = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(issue()).resolves.toStrictEqual({ error: 'chain_error', ok: false })
      expect(log).toHaveBeenCalledWith('attest outcome unknown', {
        cardId: 'receipt-card',
        txHash: chain.txs[0],
      })
      await expect(db.select().from(members)).resolves.toStrictEqual([])
      await expect(db.select({ reserved: cards.reserved }).from(cards)).resolves.toStrictEqual([
        { reserved: 1 },
      ])
      chain.unknownAttestOutcome = false
      await expect(issue()).resolves.toStrictEqual({ error: 'card_sold_out', ok: false })
    } finally {
      log.mockRestore()
    }
  })

  it('releases the place when attest fails without minting, so another claim can issue', async () => {
    const { chain, db, issue } = await setup()
    chain.failWrites = true
    await expect(issue()).resolves.toStrictEqual({ error: 'chain_error', ok: false })
    await expect(db.select().from(members)).resolves.toStrictEqual([])
    await expect(db.select({ reserved: cards.reserved }).from(cards)).resolves.toStrictEqual([
      { reserved: 0 },
    ])
    chain.failWrites = false
    await expect(issue()).resolves.toMatchObject({ ok: true })
    await expect(db.select().from(members)).resolves.toHaveLength(1)
  })
})
