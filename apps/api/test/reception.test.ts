import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createSession } from '../src/auth/session.ts'
import { getDb } from '../src/db/client.ts'
import {
  cards,
  entryLog,
  issuers,
  members,
  sessions,
  slots,
  stampCredits,
  receptionRequests,
} from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW, seedRight, seedRoot } from './fixtures.ts'
import { getJson, postJson, signIn } from './operator.ts'

const db = getDb({ DB: env.DB })
const setup = async (level = 0, usageModel = 1) => {
  const chain = fakeChain()
  const delegation = seedRoot(chain)
  const uid = seedRight(chain, delegation, { level, usageModel })
  let now = NOW
  const app = appWith({ chain, now: () => now })
  const bindings = configuredEnv(delegation)
  const { token } = await signIn(app, bindings)
  await postJson(
    app,
    bindings,
    '/v1/issuers',
    {
      brandColor: '#112233',
      handle: 'coffee',
      name: 'Coffee',
      tagline: '',
    },
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
  await db.insert(members).values({
    attestationUid: uid,
    cardId,
    createdAt: NOW,
    holder: HOLDER,
    issuerId: venue!.id,
    level: level === 0 ? 'bearer' : 'signed',
    memberId: 'member-1',
  })
  const settings = async (enabled: boolean, dailyLimit = 1, goal = 10) =>
    await app.request(
      `/v1/issuers/me/cards/${cardId}/stamps`,
      {
        body: JSON.stringify({ dailyLimit, enabled, goal }),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        method: 'PUT',
      },
      bindings,
    )
  const scan = async (requestId = crypto.randomUUID(), qr = `fuda:v1:${uid}`) =>
    await postJson(app, bindings, '/v1/issuers/me/reception', { qr, requestId }, token)
  return {
    app,
    bindings,
    cardId,
    chain,
    delegation,
    scan,
    setNow: (value: number) => {
      now = value
    },
    settings,
    token,
    uid,
    venue: venue!,
  }
}

const responseJson = async <T = unknown>(pending: Promise<Response>): Promise<T> => {
  const response = await pending
  return await response.json<T>()
}

const responseStatus = async (pending: Promise<Response>): Promise<number> => {
  const response = await pending
  return response.status
}

describe('venue reception stamps', () => {
  beforeEach(async () => {
    // Delete in dependency order; each fixture owns all rows in this test file.
    await env.DB.prepare('DELETE FROM stamp_credits').run()
    await env.DB.prepare('DELETE FROM reception_requests').run()
    await env.DB.prepare('DELETE FROM card_stamp_settings').run()
    await env.DB.prepare('DELETE FROM stamp_settings').run()
    await db.delete(entryLog)
    await db.delete(slots)
    await db.delete(members)
    await db.delete(cards)
    await db.delete(sessions)
    await db.delete(issuers)
  })

  it('admits twice but awards only the first daily stamp', async () => {
    const f = await setup()
    await expect(responseStatus(f.settings(true))).resolves.toBe(200)
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      decision: 'ADMIT',
      stamp: { status: 'awarded', summary: { goal: 10, today: 1, total: 1 } },
    })
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      decision: 'ADMIT',
      stamp: { status: 'daily_limit', summary: { today: 1, total: 1 } },
    })
    await expect(db.select().from(entryLog)).resolves.toHaveLength(2)
  })

  it('keeps membership and event ticket policies independent at reception', async () => {
    const f = await setup()
    await f.settings(true, 2, 12)
    const ticketId = crypto.randomUUID()
    const ticketUid = seedRight(f.chain, f.delegation, { usageModel: 0 })
    await db.insert(cards).values({
      category: 'ticket',
      createdAt: NOW,
      id: ticketId,
      issuerId: f.venue.id,
      slug: 'event',
      title: 'Special event',
    })
    await db.insert(members).values({
      attestationUid: ticketUid,
      cardId: ticketId,
      createdAt: NOW,
      issuerId: f.venue.id,
      level: 'bearer',
      memberId: 'ticket-member',
    })
    await expect(
      responseJson(getJson(f.app, f.bindings, `/v1/issuers/me/cards/${ticketId}/stamps`, f.token)),
    ).resolves.toStrictEqual({
      dailyLimit: 1,
      enabled: false,
      goal: 10,
    })
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      stamp: { status: 'awarded', summary: { dailyLimit: 2, enabled: true, goal: 12, total: 1 } },
    })
    await expect(responseJson(f.scan(crypto.randomUUID(), `fuda:v1:${ticketUid}`))).resolves.toMatchObject({
      decision: 'ADMIT',
      stamp: { status: 'disabled', summary: { enabled: false, total: 0 } },
    })
    await expect(responseJson(getJson(f.app, f.bindings, `/v1/stamps/${ticketUid}`))).resolves.toMatchObject({
      enabled: false,
      total: 0,
    })
  })

  it('does not apply a card policy to a cardless Right', async () => {
    const f = await setup()
    await f.settings(true)
    await db.update(members).set({ cardId: null }).where(eq(members.attestationUid, f.uid))
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      stamp: { status: 'disabled', summary: { enabled: false, total: 0 } },
    })
    await expect(responseJson(getJson(f.app, f.bindings, `/v1/stamps/${f.uid}`))).resolves.toMatchObject({
      enabled: false,
      total: 0,
    })
  })

  it('rejects foreign and missing Card settings and does not expose the old venue-wide route', async () => {
    const f = await setup()
    const otherToken = await createSession(db, {
      address: HOLDER,
      audience: 'operator',
      issuerId: 'another-venue',
      now: NOW,
    })
    const path = `/v1/issuers/me/cards/${f.cardId}/stamps`
    const statuses = await Promise.all([
      getJson(f.app, f.bindings, path),
      getJson(f.app, f.bindings, path, otherToken),
      getJson(f.app, f.bindings, '/v1/issuers/me/cards/missing/stamps', f.token),
      getJson(f.app, f.bindings, '/v1/issuers/me/stamps', f.token),
      f.app.request(
        path,
        {
          body: JSON.stringify({ dailyLimit: 1, enabled: true, goal: 10 }),
          headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' },
          method: 'PUT',
        },
        f.bindings,
      ),
    ])
    expect(statuses.map((response) => response.status)).toStrictEqual([401, 404, 404, 404, 404])
  })

  it('uses Japan midnight and keeps accumulated stamps across days', async () => {
    const f = await setup()
    await f.settings(true)
    f.setNow(Date.parse('2026-09-09T14:59:59Z') / 1000)
    // Sessions have a 30-day lifetime: keep this boundary within the fixture session.
    await db.update(sessions).set({ expiresAt: 2_000_000_000 })
    await f.scan()
    f.setNow(Date.parse('2026-09-09T15:00:00Z') / 1000)
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      stamp: { status: 'awarded', summary: { today: 1, total: 2 } },
    })
  })

  it('caps simultaneous scans at the configured limit and replays a request once', async () => {
    const f = await setup()
    await f.settings(true, 2)
    const responses = await Promise.all(
      Array.from({ length: 6 }, async () => await responseJson<{ stamp: { status: string } }>(f.scan())),
    )
    expect(responses.filter((r) => r.stamp.status === 'awarded')).toHaveLength(2)
    const id = crypto.randomUUID()
    const duplicate = await Promise.all([f.scan(id), f.scan(id)])
    const repeatedBody = await duplicate[1].json()
    await expect(duplicate[0].json()).resolves.toStrictEqual(repeatedBody)
    await expect(db.select().from(entryLog)).resolves.toHaveLength(7)
  })

  it('defaults disabled, retains stamps when disabled and does not reset at the goal', async () => {
    const f = await setup()
    await expect(
      responseJson(getJson(f.app, f.bindings, `/v1/issuers/me/cards/${f.cardId}/stamps`, f.token)),
    ).resolves.toStrictEqual({ dailyLimit: 1, enabled: false, goal: 10 })
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      stamp: { status: 'disabled', summary: { total: 0 } },
    })
    await f.settings(true, 3, 1)
    await f.scan()
    await f.scan()
    await f.settings(false)
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      decision: 'ADMIT',
      stamp: { status: 'disabled', summary: { total: 2 } },
    })
  })

  it('requires an operator venue and refuses foreign rights before chain reads', async () => {
    const f = await setup()
    await expect(
      responseStatus(
        postJson(f.app, f.bindings, '/v1/issuers/me/reception', {
          qr: `fuda:v1:${f.uid}`,
          requestId: crypto.randomUUID(),
        }),
      ),
    ).resolves.toBe(401)
    await db.update(members).set({ issuerId: 'another-venue' }).where(eq(members.attestationUid, f.uid))
    f.chain.failReads = true
    await expect(responseStatus(f.scan())).resolves.toBe(404)
    await expect(db.select().from(entryLog)).resolves.toHaveLength(0)
  })

  it('does not stamp public verification or previews', async () => {
    const f = await setup()
    await f.settings(true)
    await postJson(f.app, f.bindings, '/v1/verify', { qr: `fuda:v1:${f.uid}` })
    await getJson(f.app, f.bindings, `/v1/verify/${f.uid}`)
    await expect(responseJson(getJson(f.app, f.bindings, `/v1/stamps/${f.uid}`))).resolves.toMatchObject({
      today: 0,
      total: 0,
    })
  })

  it('rejects revoked rights without stamping', async () => {
    const f = await setup()
    await f.settings(true)
    f.chain.revokeAt(f.uid, 1n)
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      decision: 'REJECT',
      reason: 'REVOKED',
      stamp: { status: 'not_admitted' },
    })
  })

  it('keeps single-use consumption and signed QR rejection', async () => {
    const f = await setup(0, 0)
    await f.settings(true, 2)
    await f.scan()
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      decision: 'REJECT',
      reason: 'ALREADY_USED',
      stamp: { status: 'not_admitted' },
    })
  })

  it('does not stamp signed QR presentations', async () => {
    const f = await setup(1)
    await f.settings(true)
    await expect(responseJson(f.scan())).resolves.toMatchObject({
      decision: 'REJECT',
      reason: 'LEVEL_REQUIRED',
      stamp: { status: 'not_admitted' },
    })
  })

  it('validates settings and QR input without writes', async () => {
    const f = await setup()
    const statuses = await Promise.all(
      [
        f.settings(true, 0),
        f.settings(true, 1.5),
        f.settings(true, 101),
        f.settings(true, 1, 0),
        f.scan(crypto.randomUUID(), f.uid),
      ].map(async (pending) => await responseStatus(pending)),
    )
    expect(statuses).toStrictEqual([400, 400, 400, 400, 400])
    await expect(db.select().from(entryLog)).resolves.toHaveLength(0)
  })

  it('replays a successful receipt even after revocation without another Entry', async () => {
    const f = await setup()
    await f.settings(true)
    const id = crypto.randomUUID()
    const first = await responseJson(f.scan(id))
    f.chain.revokeAt(f.uid, 1n)
    await expect(responseJson(f.scan(id))).resolves.toStrictEqual(first)
    await expect(db.select().from(entryLog)).resolves.toHaveLength(1)
  })

  it('shares SINGLE_USE consumption with concurrent public QR verification', async () => {
    const f = await setup(0, 0)
    await f.settings(true)
    const responses = await Promise.all([
      responseJson<{ decision: string }>(f.scan()),
      responseJson<{ decision: string }>(
        postJson(f.app, f.bindings, '/v1/verify', { qr: `fuda:v1:${f.uid}` }),
      ),
    ])
    expect(responses.filter((r) => r.decision === 'ADMIT')).toHaveLength(1)
    await expect(db.select().from(slots)).resolves.toHaveLength(1)
    await expect(db.select().from(entryLog)).resolves.toHaveLength(2)
  })

  it('conflicts on a simultaneous request ID reused for another owned Right', async () => {
    const f = await setup()
    await f.settings(true)
    const otherUid = `0x${'cd'.repeat(32)}`
    // The competing request must not overwrite or partially mutate a receipt.
    await db.insert(members).values({
      attestationUid: otherUid,
      createdAt: NOW,
      issuerId: f.venue.id,
      level: 'bearer',
      memberId: 'member-2',
    })
    const id = crypto.randomUUID()
    const results = await Promise.all([f.scan(id), f.scan(id, `fuda:v1:${otherUid}`)])
    expect(results.map((res) => res.status).toSorted((a, b) => a - b)).toStrictEqual([200, 409])
    await expect(db.select().from(entryLog)).resolves.toHaveLength(1)
    await expect(db.select().from(receptionRequests)).resolves.toHaveLength(1)
  })

  it('rejects member sessions and operators without a venue', async () => {
    const f = await setup()
    const memberToken = await createSession(db, {
      address: HOLDER,
      audience: 'member',
      issuerId: f.venue.id,
      now: NOW,
    })
    const emptyToken = await createSession(db, {
      address: HOLDER,
      audience: 'operator',
      issuerId: null,
      now: NOW,
    })
    const request = { qr: `fuda:v1:${f.uid}`, requestId: crypto.randomUUID() }
    const results = await Promise.all([
      postJson(f.app, f.bindings, '/v1/issuers/me/reception', request, memberToken),
      postJson(f.app, f.bindings, '/v1/issuers/me/reception', request, emptyToken),
    ])
    expect(results.map((res) => res.status)).toStrictEqual([401, 404])
    await expect(db.select().from(entryLog)).resolves.toHaveLength(0)
  })

  it('does not expose private or unknown stamp summaries', async () => {
    const f = await setup()
    await db.update(members).set({ level: 'private' })
    const results = await Promise.all([
      getJson(f.app, f.bindings, `/v1/stamps/${f.uid}`),
      getJson(f.app, f.bindings, `/v1/stamps/0x${'ef'.repeat(32)}`),
    ])
    expect(results.map((res) => res.status)).toStrictEqual([404, 404])
    await expect(Promise.all(results.map(async (res) => await res.json()))).resolves.toStrictEqual([
      { error: 'not_found' },
      { error: 'not_found' },
    ])
  })

  it('does not record an uncertain chain verdict and permits retry after recovery', async () => {
    const f = await setup()
    await f.settings(true)
    f.chain.failReads = true
    const id = crypto.randomUUID()
    await expect(responseStatus(f.scan(id))).resolves.toBe(502)
    await expect(db.select().from(entryLog)).resolves.toHaveLength(0)
    await expect(db.select().from(stampCredits)).resolves.toHaveLength(0)
    f.chain.failReads = false
    await expect(responseJson(f.scan(id))).resolves.toMatchObject({
      decision: 'ADMIT',
      stamp: { status: 'awarded' },
    })
  })

  it('rolls back the whole receipt when durable stamp recording fails', async () => {
    const f = await setup(0, 0)
    await f.settings(true)
    await env.DB.prepare(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON reception_requests BEGIN SELECT RAISE(ABORT, 'test receipt failure'); END",
    ).run()
    try {
      await expect(responseStatus(f.scan())).resolves.toBe(500)
      await expect(db.select().from(entryLog)).resolves.toHaveLength(0)
      await expect(db.select().from(stampCredits)).resolves.toHaveLength(0)
      await expect(db.select().from(slots)).resolves.toHaveLength(0)
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_receipt').run()
    }
  })

  it('fires the Attendance hook once for a successful replayed reception', async () => {
    const f = await setup()
    const hookEntries: number[] = []
    const app = appWith({
      chain: f.chain,
      now: () => NOW,
      onAdmit: (info) => {
        hookEntries.push(info.entryLogId)
      },
    })
    const request = { qr: `fuda:v1:${f.uid}`, requestId: crypto.randomUUID() }
    await Promise.all([
      postJson(app, f.bindings, '/v1/issuers/me/reception', request, f.token),
      postJson(app, f.bindings, '/v1/issuers/me/reception', request, f.token),
    ])
    const rows = await db.select().from(entryLog)
    expect(hookEntries).toStrictEqual([rows[0]?.id])
  })
})
