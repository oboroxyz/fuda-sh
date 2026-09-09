import type { CardView, IssuerPassesResponse, OperatorCardView } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createSession } from '../src/auth/session.ts'
import { getDb } from '../src/db/client.ts'
import {
  cards,
  cardStampSettings,
  challenges,
  entryLog,
  issuers,
  members,
  receptionRequests,
  sessions,
  slots,
  stampCredits,
} from '../src/db/schema.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { other } from './fixtures.ts'
import { CARD_INPUT, getJson, operator, postJson, registerVenueWithCard, signIn } from './operator.ts'

const NOW = 1000
const bindings = () => testEnv({ ENS_PARENT_NAME: 'fuda.eth' })
const db = () => getDb({ DB: env.DB })

const putJson = async (
  app: ReturnType<typeof appWith>,
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token !== undefined) {
    headers.set('authorization', `Bearer ${token}`)
  }
  return await app.request(path, { body: JSON.stringify(body), headers, method: 'PUT' }, bindings())
}

const clearManagementTables = async (): Promise<void> => {
  const database = db()
  await database.delete(receptionRequests)
  await database.delete(stampCredits)
  await database.delete(entryLog)
  await database.delete(slots)
  await database.delete(members)
  await database.delete(cardStampSettings)
  await database.delete(sessions)
  await database.delete(challenges)
  await database.delete(cards)
  await database.delete(issuers)
}

const createOwnedCard = async () => {
  const app = appWith({ chain: fakeChain(), now: () => NOW })
  const { token } = await signIn(app, bindings())
  await registerVenueWithCard(
    app,
    bindings(),
    {
      ...CARD_INPUT,
      card: {
        ...CARD_INPUT.card,
        claimFrom: 10,
        claimUntil: 2000,
        lockScreen: true,
        validFrom: 20,
        validUntil: 3000,
        validityDays: null,
        venue: { lat: 35.6762, lng: 139.6503 },
      },
    },
    token,
  )
  const card = await db().select().from(cards).get()
  if (card === undefined) {
    throw new Error('card fixture was not created')
  }
  return { app, card, token }
}

interface SeedPass {
  cardId: string | null
  createdAt: number
  holder?: string | null
  issuerId: string
  level?: 'bearer' | 'signed' | 'private'
  memberNumber: string
  status?: 'active' | 'revoked'
  uidNumber: number
  usageModel: number | null
  validFrom: number | null
  validUntil: number | null
}

const uidFor = (number: number): string => `0x${number.toString(16).padStart(64, '0')}`

const seedPass = async (pass: SeedPass): Promise<string> => {
  const uid = uidFor(pass.uidNumber)
  await env.DB.prepare(
    `INSERT INTO members (
      attestation_uid, card_id, created_at, holder, issuer_id, level, member_id,
      status, tier, usage_model, valid_from, valid_until
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11)`,
  )
    .bind(
      uid,
      pass.cardId,
      pass.createdAt,
      pass.holder === undefined ? `0x${'12'.repeat(20)}` : pass.holder,
      pass.issuerId,
      pass.level ?? 'bearer',
      pass.memberNumber,
      pass.status ?? 'active',
      pass.usageModel,
      pass.validFrom,
      pass.validUntil,
    )
    .run()
  return uid
}

describe('operator Card management', () => {
  beforeEach(clearManagementTables)

  it('hydrates stored operator-only fields without changing public CardView', async () => {
    const { app, card, token } = await createOwnedCard()

    const response = await getJson(app, bindings(), `/v1/issuers/me/cards/${card.id}`, token)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json<{ card: OperatorCardView }>()).resolves.toStrictEqual({
      card: {
        category: 'membership',
        claimFrom: 10,
        claimUntil: 2000,
        claimable: true,
        description: CARD_INPUT.card.description,
        id: card.id,
        lockScreen: true,
        slug: CARD_INPUT.card.slug,
        title: CARD_INPUT.card.title,
        validFrom: 20,
        validUntil: 3000,
        validityDays: null,
        venue: { lat: 35.6762, lng: 139.6503 },
      },
    })
    const publicResponse = await getJson(app, bindings(), `/v1/issuers/${CARD_INPUT.handle}`)
    const publicBody = await publicResponse.json<{ cards: CardView[] }>()
    expect(publicBody.cards[0]).not.toHaveProperty('lockScreen')
    expect(publicBody.cards[0]).not.toHaveProperty('venue')
  })

  /* oxlint-disable vitest/max-expects -- one save must prove its response and coupled persistence invariants together */
  it('replaces editable fields, preserves identity and clears omitted venue coordinates', async () => {
    const { app, card, token } = await createOwnedCard()
    await db().insert(cardStampSettings).values({ cardId: card.id, dailyLimit: 2, enabled: true, goal: 8 })
    const issuedUid = await seedPass({
      cardId: card.id,
      createdAt: 900,
      issuerId: card.issuerId,
      memberNumber: 'already-issued',
      uidNumber: 99,
      usageModel: 1,
      validFrom: 0,
      validUntil: 0,
    })
    const update = {
      category: 'ticket',
      claimFrom: null,
      claimUntil: 2500,
      description: 'One admission',
      lockScreen: false,
      title: 'Autumn Gig',
      validFrom: 1100,
      validUntil: 1900,
      validityDays: null,
    }

    const response = await putJson(app, `/v1/issuers/me/cards/${card.id}`, update, token)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json<{ card: OperatorCardView }>()).resolves.toMatchObject({
      card: { ...update, claimable: true, id: card.id, slug: CARD_INPUT.card.slug, venue: null },
    })
    const stored = await db().select().from(cards).where(eq(cards.id, card.id)).get()
    expect(stored).toMatchObject({
      ...update,
      createdAt: card.createdAt,
      id: card.id,
      issuerId: card.issuerId,
      lockScreen: 0,
      slug: card.slug,
      venueLat: null,
      venueLng: null,
    })
    await expect(
      db().select().from(cardStampSettings).where(eq(cardStampSettings.cardId, card.id)).get(),
    ).resolves.toMatchObject({ enabled: false })
    await expect(
      db().select().from(members).where(eq(members.attestationUid, issuedUid)).get(),
    ).resolves.toMatchObject({ usageModel: 1, validFrom: 0, validUntil: 0 })
  })
  /* oxlint-enable vitest/max-expects */

  it.each(['slug', 'issuerId'])('rejects immutable or tenant-controlled field %s', async (field) => {
    const { app, card, token } = await createOwnedCard()
    const response = await putJson(
      app,
      `/v1/issuers/me/cards/${card.id}`,
      {
        category: 'membership',
        claimFrom: null,
        claimUntil: null,
        description: '',
        lockScreen: false,
        title: 'Card',
        validFrom: null,
        validUntil: null,
        validityDays: null,
        [field]: 'forbidden',
      },
      token,
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toStrictEqual({ error: 'bad_input' })
  })

  it('requires an operator session and hides missing or foreign Cards', async () => {
    const { app, card } = await createOwnedCard()
    const { token: foreignToken } = await signIn(app, bindings(), other)
    const memberToken = await createSession(db(), {
      address: operator.address,
      audience: 'member',
      issuerId: null,
      now: NOW,
    })

    const unauthorized = await Promise.all(
      [undefined, memberToken].map(
        async (token) => await getJson(app, bindings(), `/v1/issuers/me/cards/${card.id}`, token),
      ),
    )
    expect(unauthorized.map((response) => response.status)).toStrictEqual([401, 401])
    const hidden = await Promise.all(
      [card.id, 'missing'].map(
        async (id) => await getJson(app, bindings(), `/v1/issuers/me/cards/${id}`, foreignToken),
      ),
    )
    expect(hidden.map((response) => response.status)).toStrictEqual([404, 404])
    await expect(Promise.all(hidden.map(async (response) => await response.json()))).resolves.toStrictEqual([
      { error: 'not_found' },
      { error: 'not_found' },
    ])
  })

  it('edits a legacy Card whose immutable slug is now reserved', async () => {
    const { app, card, token } = await createOwnedCard()
    await db().update(cards).set({ slug: 'new' }).where(eq(cards.id, card.id))
    const response = await putJson(
      app,
      `/v1/issuers/me/cards/${card.id}`,
      {
        category: 'membership',
        claimFrom: null,
        claimUntil: null,
        description: '',
        lockScreen: false,
        title: 'Legacy Card',
        validFrom: null,
        validUntil: null,
        validityDays: null,
      },
      token,
    )
    expect(response.status).toBe(200)
    await expect(response.json<{ card: OperatorCardView }>()).resolves.toMatchObject({
      card: { slug: 'new', title: 'Legacy Card' },
    })
  })

  it('refuses to enable Stamp settings for a Ticket', async () => {
    const { app, card, token } = await createOwnedCard()
    await db().update(cards).set({ category: 'ticket' }).where(eq(cards.id, card.id))

    const response = await putJson(
      app,
      `/v1/issuers/me/cards/${card.id}/stamps`,
      { dailyLimit: 1, enabled: true, goal: 10 },
      token,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toStrictEqual({ error: 'stamps_not_supported' })
    await expect(db().select().from(cardStampSettings)).resolves.toStrictEqual([])
  })

  it('cannot re-enable Stamp settings after a concurrent edit changes the Card to a Ticket', async () => {
    const { app, card, token } = await createOwnedCard()
    await db().insert(cardStampSettings).values({ cardId: card.id, dailyLimit: 1, enabled: false, goal: 10 })
    const bodyRead = Promise.withResolvers<null>()
    const bodyRelease = Promise.withResolvers<null>()
    const encoder = new TextEncoder()
    let suppliedRemainder = false
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (suppliedRemainder) {
          return
        }
        suppliedRemainder = true
        bodyRead.resolve(null)
        await bodyRelease.promise
        controller.enqueue(encoder.encode(',"enabled":true,"goal":10}'))
        controller.close()
      },
      start: (controller) => {
        controller.enqueue(encoder.encode('{"dailyLimit":1'))
      },
    })
    const stampRequest = app.request(
      `/v1/issuers/me/cards/${card.id}/stamps`,
      {
        body,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        method: 'PUT',
      },
      bindings(),
    )
    await bodyRead.promise

    const cardResponse = await putJson(
      app,
      `/v1/issuers/me/cards/${card.id}`,
      {
        category: 'ticket',
        claimFrom: null,
        claimUntil: null,
        description: '',
        lockScreen: false,
        title: 'Concurrent Ticket',
        validFrom: null,
        validUntil: null,
        validityDays: null,
      },
      token,
    )
    expect(cardResponse.status).toBe(200)
    bodyRelease.resolve(null)

    const stampResponse = await stampRequest
    expect(stampResponse.status).toBe(409)
    await expect(stampResponse.json()).resolves.toStrictEqual({ error: 'stamps_not_supported' })
    await expect(
      db().select().from(cardStampSettings).where(eq(cardStampSettings.cardId, card.id)).get(),
    ).resolves.toMatchObject({ enabled: false })
  })

  it('cannot disable a foreign Card Stamp setting through a Ticket update', async () => {
    const { app, card, token } = await createOwnedCard()
    const foreignIssuerId = 'foreign-issuer'
    const foreignCardId = 'foreign-card'
    await db().insert(issuers).values({
      brandColor: '#000000',
      createdAt: NOW,
      handle: 'foreign',
      id: foreignIssuerId,
      name: 'Foreign Venue',
      operatorAddress: other.address.toLowerCase(),
      tagline: '',
    })
    await db().insert(cards).values({
      category: 'membership',
      createdAt: NOW,
      description: '',
      id: foreignCardId,
      issuerId: foreignIssuerId,
      lockScreen: 0,
      slug: 'foreign-card',
      title: 'Foreign Card',
    })
    await db()
      .insert(cardStampSettings)
      .values({ cardId: foreignCardId, dailyLimit: 1, enabled: true, goal: 10 })

    const response = await putJson(
      app,
      `/v1/issuers/me/cards/${foreignCardId}`,
      {
        category: 'ticket',
        claimFrom: null,
        claimUntil: null,
        description: '',
        lockScreen: false,
        title: 'Foreign Ticket',
        validFrom: null,
        validUntil: null,
        validityDays: null,
      },
      token,
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toStrictEqual({ error: 'not_found' })
    await expect(
      db().select().from(cardStampSettings).where(eq(cardStampSettings.cardId, foreignCardId)).get(),
    ).resolves.toMatchObject({ enabled: true })
    await expect(db().select().from(cards).where(eq(cards.id, card.id)).get()).resolves.toMatchObject({
      category: 'membership',
    })
  })
})

describe('GET /issuers/me/passes', () => {
  beforeEach(clearManagementTables)

  it('requires an operator session', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const memberToken = await createSession(db(), {
      address: operator.address,
      audience: 'member',
      issuerId: null,
      now: NOW,
    })
    const responses = await Promise.all(
      [undefined, memberToken].map(
        async (token) => await getJson(app, bindings(), '/v1/issuers/me/passes', token),
      ),
    )
    expect(responses.map((response) => response.status)).toStrictEqual([401, 401])
  })

  it('answers 404 when the operator has no venue', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, bindings())
    const response = await getJson(app, bindings(), '/v1/issuers/me/passes', token)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toStrictEqual({ error: 'not_found' })
  })

  it('returns zero unfiltered aggregates for an empty owned venue', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, bindings())
    const { card: _card, ...venue } = CARD_INPUT
    await postJson(app, bindings(), '/v1/issuers', venue, token)

    const response = await getJson(app, bindings(), '/v1/issuers/me/passes', token)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json<IssuerPassesResponse>()).resolves.toStrictEqual({
      cardStats: [],
      page: { number: 1, size: 25, total: 0 },
      passes: [],
      summary: { active: 0, claimedLast30Days: 0, stamps: 0, total: 0, unknown: 0 },
    })
  })

  /* oxlint-disable vitest/max-expects -- one rich SQL fixture checks row, aggregate, filter and privacy invariants without repeated setup */
  it('uses immutable issuance metadata and excludes private and foreign rows from every count', async () => {
    const { app, card, token } = await createOwnedCard()
    const secondCardId = 'second-card'
    const foreignIssuerId = 'foreign-issuer'
    const foreignCardId = 'foreign-card'
    await db().insert(cards).values({
      category: 'ticket',
      createdAt: NOW,
      description: '',
      id: secondCardId,
      issuerId: card.issuerId,
      lockScreen: 0,
      slug: 'second',
      title: 'Second Card',
    })
    await db().insert(issuers).values({
      brandColor: '#000000',
      createdAt: NOW,
      handle: 'foreign',
      id: foreignIssuerId,
      name: 'Foreign Venue',
      operatorAddress: other.address.toLowerCase(),
      tagline: '',
    })
    await db().insert(cards).values({
      category: 'membership',
      createdAt: NOW,
      description: '',
      id: foreignCardId,
      issuerId: foreignIssuerId,
      lockScreen: 0,
      slug: 'foreign-card',
      title: 'Foreign Card',
    })

    const activeUid = await seedPass({
      cardId: card.id,
      createdAt: 990,
      issuerId: card.issuerId,
      memberNumber: 'active_member',
      uidNumber: 1,
      usageModel: 1,
      validFrom: 0,
      validUntil: 0,
    })
    const expiredUid = await seedPass({
      cardId: card.id,
      createdAt: 989,
      issuerId: card.issuerId,
      memberNumber: 'expired',
      uidNumber: 2,
      usageModel: 0,
      validFrom: 0,
      validUntil: NOW - 1,
    })
    await seedPass({
      cardId: card.id,
      createdAt: 988,
      issuerId: card.issuerId,
      memberNumber: 'future',
      uidNumber: 3,
      usageModel: 1,
      validFrom: NOW + 1,
      validUntil: 0,
    })
    await seedPass({
      cardId: secondCardId,
      createdAt: 987,
      issuerId: card.issuerId,
      memberNumber: 'revoked',
      status: 'revoked',
      uidNumber: 4,
      usageModel: null,
      validFrom: null,
      validUntil: null,
    })
    const consumedUid = await seedPass({
      cardId: card.id,
      createdAt: 986,
      issuerId: card.issuerId,
      memberNumber: 'consumed',
      uidNumber: 5,
      usageModel: 0,
      validFrom: 0,
      validUntil: 0,
    })
    await seedPass({
      cardId: card.id,
      createdAt: 985,
      holder: null,
      issuerId: card.issuerId,
      memberNumber: 'historic',
      uidNumber: 6,
      usageModel: null,
      validFrom: null,
      validUntil: null,
    })
    const meteredUid = await seedPass({
      cardId: card.id,
      createdAt: 984,
      issuerId: card.issuerId,
      memberNumber: 'metered',
      uidNumber: 7,
      usageModel: 2,
      validFrom: 0,
      validUntil: NOW,
    })
    await seedPass({
      cardId: card.id,
      createdAt: 983,
      issuerId: card.issuerId,
      level: 'private',
      memberNumber: 'private-secret',
      uidNumber: 8,
      usageModel: 1,
      validFrom: 0,
      validUntil: 0,
    })
    await seedPass({
      cardId: foreignCardId,
      createdAt: 982,
      issuerId: foreignIssuerId,
      memberNumber: 'foreign-secret',
      uidNumber: 9,
      usageModel: 1,
      validFrom: 0,
      validUntil: 0,
    })
    await db()
      .insert(slots)
      .values([
        { consumedAt: 995, slot: 'default', uid: expiredUid },
        { consumedAt: 995, slot: 'default', uid: consumedUid },
        { consumedAt: 995, slot: 'default', uid: meteredUid },
      ])
    const logs = await db()
      .insert(entryLog)
      .values([
        { at: 995, decision: 'ADMIT', path: 'qr', reason: 'OK', uid: activeUid },
        { at: 996, decision: 'ADMIT', path: 'qr', reason: 'OK', uid: activeUid },
        { at: 997, decision: 'ADMIT', path: 'qr', reason: 'OK', uid: consumedUid },
      ])
      .returning({ id: entryLog.id })
    await db()
      .insert(stampCredits)
      .values(
        logs.map(({ id }, index) => ({
          at: 995 + index,
          day: '1970-01-01',
          entryLogId: id,
          issuerId: card.issuerId,
          operatorAddress: operator.address,
          ordinal: index + 1,
          uid: index === 2 ? consumedUid : activeUid,
        })),
      )

    const response = await getJson(app, bindings(), '/v1/issuers/me/passes?pageSize=100', token)
    expect(response.status).toBe(200)
    const body = await response.json<IssuerPassesResponse>()
    expect(body.page).toStrictEqual({ number: 1, size: 100, total: 7 })
    expect(body.summary).toStrictEqual({
      active: 2,
      claimedLast30Days: 7,
      stamps: 3,
      total: 7,
      unknown: 1,
    })
    expect(body.cardStats).toStrictEqual([
      { active: 2, cardId: card.id, issued: 6, unknown: 1 },
      { active: 0, cardId: secondCardId, issued: 1, unknown: 0 },
    ])
    expect(body.passes.map((pass) => pass.status)).toStrictEqual([
      'active',
      'expired',
      'not_yet_valid',
      'revoked',
      'consumed',
      'unknown',
      'active',
    ])
    expect(body.passes[0]).toMatchObject({
      card: {
        category: 'membership',
        id: card.id,
        slug: CARD_INPUT.card.slug,
        title: CARD_INPUT.card.title,
      },
      claimedAt: 990,
      memberNumber: 'active_member',
      stamps: 2,
      uid: activeUid,
      validFrom: 0,
      validUntil: 0,
    })
    expect(body.passes[5]).toMatchObject({ holder: null, status: 'unknown' })
    expect(JSON.stringify(body)).not.toContain('private-secret')
    expect(JSON.stringify(body)).not.toContain('foreign-secret')

    const filtered = await getJson(app, bindings(), '/v1/issuers/me/passes?status=active', token)
    const filteredBody = await filtered.json<IssuerPassesResponse>()
    expect(filteredBody.page.total).toBe(2)
    expect(filteredBody.summary).toStrictEqual(body.summary)
    expect(filteredBody.cardStats).toStrictEqual(body.cardStats)

    const escapedSearch = await getJson(app, bindings(), '/v1/issuers/me/passes?q=_', token)
    const escapedSearchBody = await escapedSearch.json<IssuerPassesResponse>()
    expect(escapedSearchBody.passes.map((pass) => pass.uid)).toStrictEqual([activeUid])
    const foreignFilter = await getJson(
      app,
      bindings(),
      `/v1/issuers/me/passes?cardId=${foreignCardId}`,
      token,
    )
    const foreignFilteredBody = await foreignFilter.json<IssuerPassesResponse>()
    expect(foreignFilteredBody.page.total).toBe(0)
    expect(foreignFilteredBody.passes).toStrictEqual([])
    expect(foreignFilteredBody.summary).toStrictEqual(body.summary)

    const ownedCardFilter = await getJson(
      app,
      bindings(),
      `/v1/issuers/me/passes?cardId=${secondCardId}`,
      token,
    )
    const ownedCardBody = await ownedCardFilter.json<IssuerPassesResponse>()
    expect(ownedCardBody.page.total).toBe(1)
    expect(ownedCardBody.passes[0]).toMatchObject({ memberNumber: 'revoked', status: 'revoked' })
    expect(ownedCardBody.summary).toStrictEqual(body.summary)
  })
  /* oxlint-enable vitest/max-expects */

  it('uses SQL pagination beyond the legacy 200-row cap with stable tie ordering', async () => {
    const { app, card, token } = await createOwnedCard()
    for (let start = 0; start < 205; start += 20) {
      const batch = Array.from({ length: Math.min(20, 205 - start) }, (_, offset) => {
        const number = start + offset + 1
        return env.DB.prepare(
          `INSERT INTO members (
            attestation_uid, card_id, created_at, holder, issuer_id, level, member_id,
            status, tier, usage_model, valid_from, valid_until
          ) VALUES (?1, ?2, 900, NULL, ?3, 'bearer', ?4, 'active', 0, 1, 0, 0)`,
        ).bind(uidFor(number), card.id, card.issuerId, `member-${number}`)
      })
      // oxlint-disable-next-line no-await-in-loop -- D1 batch size stays bounded while seeding the pagination fixture
      await env.DB.batch(batch)
    }

    const response = await getJson(app, bindings(), '/v1/issuers/me/passes?page=3&pageSize=100', token)
    const body = await response.json<IssuerPassesResponse>()

    expect(body.page).toStrictEqual({ number: 3, size: 100, total: 205 })
    expect(body.passes).toHaveLength(5)
    expect(body.passes.map((pass) => pass.uid)).toStrictEqual([201, 202, 203, 204, 205].map(uidFor))
    expect(body.summary).toStrictEqual({
      active: 205,
      claimedLast30Days: 205,
      stamps: 0,
      total: 205,
      unknown: 0,
    })
    expect(body.cardStats).toStrictEqual([{ active: 205, cardId: card.id, issued: 205, unknown: 0 }])
  })

  it.each([
    'page=0',
    'page=1.5',
    'page=9007199254740992',
    'pageSize=0',
    'pageSize=101',
    `q=${'a'.repeat(121)}`,
    'status=missing',
  ])('rejects malformed filter %s', async (query) => {
    const { app, token } = await createOwnedCard()
    const response = await getJson(app, bindings(), `/v1/issuers/me/passes?${query}`, token)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toStrictEqual({ error: 'bad_input' })
  })
})
