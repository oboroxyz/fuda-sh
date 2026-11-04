import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import {
  cards,
  entryLog,
  issuers,
  members,
  sessions,
  stampAdjustments,
  stampCredits,
} from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW } from './fixtures.ts'
import { getJson, postJson, signIn } from './operator.ts'

const db = getDb({ DB: env.DB })

interface LedgerBody {
  entries: { delta: number; kind: string; note: string }[]
  entry: { delta: number; kind: string; note: string }
  summary: { goal: number; total: number }
}

const uidOf = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`

const setup = async () => {
  const chain = fakeChain()
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv('0x')
  const { token } = await signIn(app, bindings)
  await postJson(
    app,
    bindings,
    '/v1/issuers',
    { brandColor: '#112233', handle: 'coffee', name: 'Coffee', tagline: '' },
    token,
  )
  const venue = await db.select().from(issuers).get()
  const cardId = crypto.randomUUID()
  await db.insert(cards).values({
    category: 'membership',
    createdAt: NOW,
    id: cardId,
    issuerId: venue!.id,
    slug: 'coffee',
    title: 'Coffee membership',
  })
  await env.DB.prepare('INSERT INTO card_stamp_settings (card_id, daily_limit, enabled, goal) VALUES (?, 1, 1, 3)')
    .bind(cardId)
    .run()
  let next = 1
  // A pass holding `credits` stamps, written the way reception writes them.
  const pass = async (credits: number, over: { issuerId?: string; status?: 'active' | 'revoked' } = {}) => {
    const uid = uidOf(next++)
    const issuerId = over.issuerId ?? venue!.id
    await db.insert(members).values({
      attestationUid: uid,
      cardId,
      createdAt: NOW,
      holder: HOLDER,
      issuerId,
      level: 'bearer',
      memberId: `member-${uid.slice(-4)}`,
      status: over.status ?? 'active',
    })
    for (let ordinal = 1; ordinal <= credits; ordinal += 1) {
      // oxlint-disable-next-line no-await-in-loop -- ordinals are inserted in order
      const [log] = await db
        .insert(entryLog)
        .values({ at: NOW, decision: 'ADMIT', path: 'qr', reason: 'OK', uid })
        .returning({ id: entryLog.id })
      // oxlint-disable-next-line no-await-in-loop -- depends on the entry just written
      await db.insert(stampCredits).values({
        at: NOW,
        day: `2026-01-${String(ordinal).padStart(2, '0')}`,
        entryLogId: log!.id,
        issuerId,
        operatorAddress: HOLDER,
        ordinal: 1,
        uid,
      })
    }
    return uid
  }
  const redeem = async (uid: string, requestId = crypto.randomUUID()) =>
    await postJson(app, bindings, '/v1/issuers/me/stamps/redeem', { requestId, uid }, token)
  const adjust = async (uid: string, delta: number, note = 'miscount', requestId = crypto.randomUUID()) =>
    await postJson(app, bindings, '/v1/issuers/me/stamps/adjust', { delta, note, requestId, uid }, token)
  return { adjust, app, bindings, cardId, pass, redeem, token, venue: venue! }
}

describe('stamp ledger', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM stamp_adjustments').run()
    await env.DB.prepare('DELETE FROM stamp_credits').run()
    await env.DB.prepare('DELETE FROM card_stamp_settings').run()
    await db.delete(entryLog)
    await db.delete(members)
    await db.delete(cards)
    await db.delete(sessions)
    await db.delete(issuers)
  })

  it('redeems a full card for the goal and keeps the credits', async () => {
    const f = await setup()
    const uid = await f.pass(4)
    const response = await f.redeem(uid)
    expect(response.status).toBe(200)
    const body = await response.json<LedgerBody>()
    expect(body.entry).toMatchObject({ delta: -3, kind: 'redeem' })
    expect(body.summary).toMatchObject({ goal: 3, total: 1 })
    await expect(db.select().from(stampCredits)).resolves.toHaveLength(4)
    const read = await getJson(f.app, f.bindings, `/v1/stamps/${uid}`)
    await expect(read.json()).resolves.toMatchObject({ total: 1 })
  })

  it('refuses a redemption below the goal', async () => {
    const f = await setup()
    const uid = await f.pass(2)
    const response = await f.redeem(uid)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toStrictEqual({ error: 'not_full' })
    await expect(db.select().from(stampAdjustments)).resolves.toHaveLength(0)
  })

  it('does nothing twice for a repeated request id', async () => {
    const f = await setup()
    const uid = await f.pass(6)
    const requestId = crypto.randomUUID()
    const first = await f.redeem(uid, requestId)
    const second = await f.redeem(uid, requestId)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(second.json<LedgerBody>()).resolves.toMatchObject({ summary: { total: 3 } })
    await expect(db.select().from(stampAdjustments)).resolves.toHaveLength(1)
    const reused = await f.adjust(uid, 1, 'other', requestId)
    expect(reused.status).toBe(409)
  })

  it('lets only one of two simultaneous redemptions of the last goal through', async () => {
    const f = await setup()
    const uid = await f.pass(3)
    const results = await Promise.all([f.redeem(uid), f.redeem(uid), f.redeem(uid)])
    expect(results.map((r) => r.status).toSorted()).toStrictEqual([200, 409, 409])
    await expect(db.select().from(stampAdjustments)).resolves.toHaveLength(1)
    const read = await getJson(f.app, f.bindings, `/v1/stamps/${uid}`)
    await expect(read.json()).resolves.toMatchObject({ total: 0 })
  })

  it('adjusts within bounds, needs a note, and never goes below zero', async () => {
    const f = await setup()
    const uid = await f.pass(2)
    const up = await f.adjust(uid, 3, '  forgot to stamp  ')
    expect(up.status).toBe(200)
    await expect(up.json<LedgerBody>()).resolves.toMatchObject({
      entry: { delta: 3, kind: 'adjust', note: 'forgot to stamp' },
      summary: { total: 5 },
    })
    expect((await f.adjust(uid, -5)).status).toBe(200)
    const belowZero = await f.adjust(uid, -1)
    expect(belowZero.status).toBe(409)
    await expect(belowZero.json()).resolves.toStrictEqual({ error: 'below_zero' })
    expect((await f.adjust(uid, 0)).status).toBe(400)
    expect((await f.adjust(uid, 1.5)).status).toBe(400)
    expect((await f.adjust(uid, 51)).status).toBe(400)
    expect((await f.adjust(uid, -51)).status).toBe(400)
    expect((await f.adjust(uid, 1, '   ')).status).toBe(400)
    expect((await f.adjust(uid, 1, 'x'.repeat(201))).status).toBe(400)
    await expect(db.select().from(stampAdjustments)).resolves.toHaveLength(2)
  })

  it('sums credits, redemptions and corrections and lists the ledger newest first', async () => {
    const f = await setup()
    const uid = await f.pass(5)
    await f.redeem(uid)
    await f.adjust(uid, -1, 'counted twice')
    const read = await getJson(f.app, f.bindings, `/v1/issuers/me/stamps/${uid}`, f.token)
    expect(read.status).toBe(200)
    const body = await read.json<Omit<LedgerBody, 'entry'>>()
    expect(body.summary.total).toBe(1)
    expect(body.entries.map((e) => [e.kind, e.delta])).toStrictEqual([
      ['adjust', -1],
      ['redeem', -3],
    ])
    const listed = await getJson(f.app, f.bindings, '/v1/issuers/me/passes', f.token)
    await expect(listed.json()).resolves.toMatchObject({
      passes: [{ stamps: 1, uid }],
      summary: { stamps: 1 },
    })
  })

  it('accepts the scanned qr instead of a uid', async () => {
    const f = await setup()
    const uid = await f.pass(3)
    const response = await postJson(
      f.app,
      f.bindings,
      '/v1/issuers/me/stamps/redeem',
      { qr: `fuda:v1:${uid}`, requestId: crypto.randomUUID() },
      f.token,
    )
    expect(response.status).toBe(200)
    const both = await postJson(
      f.app,
      f.bindings,
      '/v1/issuers/me/stamps/redeem',
      { qr: `fuda:v1:${uid}`, requestId: crypto.randomUUID(), uid },
      f.token,
    )
    expect(both.status).toBe(400)
  })

  it("does not touch another venue's pass", async () => {
    const f = await setup()
    await db.insert(issuers).values({
      brandColor: '#000000',
      createdAt: NOW,
      handle: 'tea',
      id: crypto.randomUUID(),
      name: 'Tea',
      operatorAddress: HOLDER,
    })
    const other = await db.select().from(issuers).where(eq(issuers.handle, 'tea')).get()
    const uid = await f.pass(5, { issuerId: other!.id })
    expect((await f.redeem(uid)).status).toBe(404)
    expect((await f.adjust(uid, 1)).status).toBe(404)
    expect((await getJson(f.app, f.bindings, `/v1/issuers/me/stamps/${uid}`, f.token)).status).toBe(404)
    await expect(db.select().from(stampAdjustments)).resolves.toHaveLength(0)
  })

  it('refuses a revoked pass, an unknown uid and a signed-out caller', async () => {
    const f = await setup()
    const revoked = await f.pass(5, { status: 'revoked' })
    const redeemed = await f.redeem(revoked)
    expect(redeemed.status).toBe(409)
    await expect(redeemed.json()).resolves.toStrictEqual({ error: 'revoked' })
    expect((await f.adjust(revoked, 1)).status).toBe(409)
    expect((await f.redeem(uidOf(999))).status).toBe(404)
    expect((await f.redeem('nope')).status).toBe(400)
    const anonymous = await postJson(f.app, f.bindings, '/v1/issuers/me/stamps/redeem', {
      requestId: crypto.randomUUID(),
      uid: revoked,
    })
    expect(anonymous.status).toBe(401)
    await expect(db.select().from(stampAdjustments)).resolves.toHaveLength(0)
  })

  it('refuses both when the card has stamps turned off', async () => {
    const f = await setup()
    const uid = await f.pass(5)
    await env.DB.prepare('UPDATE card_stamp_settings SET enabled = 0').run()
    const response = await f.redeem(uid)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toStrictEqual({ error: 'stamps_disabled' })
    expect((await f.adjust(uid, 1)).status).toBe(409)
  })
})
