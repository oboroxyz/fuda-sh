import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeChain } from '../../test/env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from '../../test/fixtures.ts'
import { getDb } from '../db/client.ts'
import { cards, issuers, members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { requestContext } from '../request.ts'
import { issueForCard } from './issue-for-card.ts'

const setup = async () => {
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
      record: 'onchain',
      title: 'One place',
    })
    .returning()
    .get()
  const chain = fakeChain({ signer: ROOT })
  const bindings = configuredEnv(seedRoot(chain))
  const app = new Hono<AppEnv>()
  app.use('*', requestContext({ chain, now: () => NOW }))
  app.post('/', async (c) => c.json(await issueForCard(c, card, issuer, null)))
  const issue = async () => {
    const response = await app.request('/', { method: 'POST' }, bindings)
    return await response.json()
  }
  return { chain, db, issue }
}

describe(issueForCard, () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(members)
    await db.delete(cards)
    await db.delete(issuers)
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
