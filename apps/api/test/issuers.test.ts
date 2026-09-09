import { formatMemberNumber } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, challenges, issuers, members, sessions } from '../src/db/schema.ts'
import { decodeEntitlementV1 } from '../src/eas/codecs.ts'
import { mirrorIssuerName } from '../src/ens/mirror.ts'
import { ensNames } from '../src/ens/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { configuredEnv, NOW, other, ROOT, seedRoot } from './fixtures.ts'
import {
  CARD_INPUT,
  getJson,
  operator,
  postJson,
  registerVenueWithCard,
  SECOND_CARD,
  signIn,
} from './operator.ts'

interface Created {
  cards: []
  ens: null
  issuer: { id: string; handle: string; brandColor: string; operatorAddress: string }
  publicUrl: string
}

interface SelfServeIssued {
  uid: Hex
  level: string
  holder: Hex
  qr: string
  memberNumber: string
  passUrls: Record<string, string>
}

const publicEnv = (overrides: Partial<Bindings> = {}): Bindings =>
  testEnv({ PUBLIC_BASE_URL: 'https://fuda.test', ...overrides })

const issue = async (
  app: ReturnType<typeof appWith>,
  bindings: Bindings,
  ip = '203.0.113.7',
): Promise<Response> =>
  await app.request(
    '/v1/issuers/wassie-coffee/stamp/issue',
    { headers: { 'CF-Connecting-IP': ip }, method: 'POST' },
    bindings,
  )

describe('issuer onboarding', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(ensNames)
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('creates a venue without cards and binds the session to it', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    const { card: _card, ...venueInput } = CARD_INPUT
    const res = await postJson(app, publicEnv(), '/v1/issuers', venueInput, token)
    expect(res.status).toBe(201)
    const body = await res.json<Created>()
    expect(body).toMatchObject({
      cards: [],
      issuer: { brandColor: '#6F4320' },
      publicUrl: 'https://fuda.test/@wassie-coffee',
    })
    await expect(getDb({ DB: env.DB }).select().from(cards)).resolves.toStrictEqual([])
    const me = await getJson(app, publicEnv(), '/v1/issuers/me', token)
    await expect(me.json()).resolves.toStrictEqual(body)
  })

  it('finds the issuer again on the next sign-in', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const first = await signIn(app, publicEnv())
    const { card: _card, ...venueInput } = CARD_INPUT
    await postJson(app, publicEnv(), '/v1/issuers', venueInput, first.token)
    const second = await signIn(app, publicEnv())
    expect(second.issuer).toMatchObject({ handle: 'wassie-coffee' })
    const me = await getJson(app, publicEnv(), '/v1/issuers/me', second.token)
    await expect(me.json()).resolves.toMatchObject({ cards: [], issuer: { handle: 'wassie-coffee' } })
  })

  it('rejects a bad handle, a taken handle and a second issuer', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    const bad = await postJson(app, publicEnv(), '/v1/issuers', { ...CARD_INPUT, handle: 'Auth' }, token)
    await expect(bad.json()).resolves.toStrictEqual({ error: 'bad_handle' })
    // Only a handle that broke the Handle rule is bad_handle; one that is
    // missing outright never reached that rule and stays bad_input.
    const missing = await postJson(
      app,
      publicEnv(),
      '/v1/issuers',
      { ...CARD_INPUT, handle: undefined },
      token,
    )
    await expect(missing.json()).resolves.toStrictEqual({ error: 'bad_input' })
    await postJson(app, publicEnv(), '/v1/issuers', CARD_INPUT, token)
    const again = await postJson(app, publicEnv(), '/v1/issuers', { ...CARD_INPUT, handle: 'second' }, token)
    await expect(again.json()).resolves.toStrictEqual({ error: 'issuer_exists' })
    const { token: otherToken } = await signIn(app, publicEnv(), other)
    const taken = await postJson(app, publicEnv(), '/v1/issuers', CARD_INPUT, otherToken)
    expect(taken.status).toBe(409)
    await expect(taken.json()).resolves.toStrictEqual({ error: 'handle_taken' })
  })

  it('checks handle availability for a signed-in operator only', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    await postJson(app, publicEnv(), '/v1/issuers', CARD_INPUT, token)
    const taken = await getJson(app, publicEnv(), '/v1/issuers/check?handle=wassie-coffee', token)
    await expect(taken.json()).resolves.toStrictEqual({
      available: false,
      handle: 'wassie-coffee',
      valid: true,
    })
    const free = await getJson(app, publicEnv(), '/v1/issuers/check?handle=wassie-tea', token)
    await expect(free.json()).resolves.toStrictEqual({ available: true, handle: 'wassie-tea', valid: true })
    const reserved = await getJson(app, publicEnv(), '/v1/issuers/check?handle=api', token)
    await expect(reserved.json()).resolves.toStrictEqual({ available: false, handle: 'api', valid: false })
    const anonymous = await getJson(app, publicEnv(), '/v1/issuers/check?handle=x')
    expect(anonymous.status).toBe(401)
  })

  it('serves the venue and its cards without the operator address', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = publicEnv()
    const { token } = await signIn(app, bindings)
    await registerVenueWithCard(app, bindings, CARD_INPUT, token)
    const res = await getJson(app, bindings, '/v1/issuers/wassie-coffee')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json<{ brandColor: string; cards: { slug: string }[]; handle: string }>()
    expect(body).toMatchObject({ brandColor: '#6F4320', handle: 'wassie-coffee', name: 'Wassie Coffee' })
    expect(body.cards.map((card) => card.slug)).toStrictEqual(['stamp'])
    expect(body).not.toHaveProperty('operatorAddress')
    expect(JSON.stringify(body)).not.toContain('operatorAddress')
  })

  it('answers 404 for a handle nobody owns', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const missing = await getJson(app, publicEnv(), '/v1/issuers/nobody')
    expect(missing.status).toBe(404)
  })
})

const setup = async (card: Partial<typeof CARD_INPUT.card> = {}) => {
  const chain = fakeChain({ signer: ROOT })
  const del = seedRoot(chain)
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv(del, {
    API_BASE_URL: 'https://api.test',
    PUBLIC_BASE_URL: 'https://fuda.test',
  })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(app, bindings, { ...CARD_INPUT, card: { ...CARD_INPUT.card, ...card } }, token)
  return { app, bindings, chain }
}

describe('POST /issuers/:handle/issue', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(ensNames)
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('issues a Bearer right with a generated member number and pass urls', async () => {
    const { app, bindings, chain } = await setup()
    const res = await issue(app, bindings)
    expect(res.status).toBe(200)
    const body = await res.json<SelfServeIssued>()
    expect(body.level).toBe('bearer')
    expect(body.memberNumber).toMatch(/^[23456789acdefghjkmnpqrtuvwxy]{13}$/u)
    expect(body.passUrls.web).toBe(`https://api.test/pass/${body.uid}`)
    const raw = await chain.readAttestation(body.uid)
    expect(decodeEntitlementV1(raw.data)).toMatchObject({ level: 0, tier: 0, usageModel: 1, validUntil: 0n })
  })

  it('stores the card id and member number on the members row', async () => {
    const { app, bindings } = await setup()
    const res = await issue(app, bindings)
    const body = await res.json<SelfServeIssued>()
    const row = await getDb({ DB: env.DB }).select().from(members).get()
    expect(row).toMatchObject({ attestationUid: body.uid, level: 'bearer', memberId: body.memberNumber })
    expect(row?.cardId).not.toBeNull()
  })

  it('maps a ticket to SINGLE_USE and validity days to validUntil', async () => {
    const { app, bindings, chain } = await setup({ category: 'ticket', validityDays: 30 })
    const res = await issue(app, bindings)
    const body = await res.json<SelfServeIssued>()
    const raw = await chain.readAttestation(body.uid)
    expect(decodeEntitlementV1(raw.data)).toMatchObject({
      usageModel: 0,
      validUntil: BigInt(NOW + 30 * 86_400),
    })
  })

  it('answers 404 for an unknown handle, 400 without a client ip and 429 past the budget', async () => {
    const { app, bindings } = await setup()
    const unknown = await app.request(
      '/v1/issuers/nobody/stamp/issue',
      { headers: { 'CF-Connecting-IP': '203.0.113.9' }, method: 'POST' },
      bindings,
    )
    expect(unknown.status).toBe(404)
    const noIp = await app.request('/v1/issuers/wassie-coffee/stamp/issue', { method: 'POST' }, bindings)
    expect(noIp.status).toBe(400)
    const statuses: number[] = []
    for (let n = 0; n < 21; n += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the budget counts sequential requests
      const res = await issue(app, bindings, '203.0.113.20')
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
  })

  it('answers 501 without a signer and 502 when the deployment cannot issue', async () => {
    const app = appWith({ chain: fakeChain({ signer: null }), now: () => NOW })
    const bindings = publicEnv()
    const { token } = await signIn(app, bindings)
    await registerVenueWithCard(app, bindings, CARD_INPUT, token)
    const noSigner = await issue(app, bindings)
    expect(noSigner.status).toBe(501)
    const signing = appWith({ chain: fakeChain({ signer: ROOT }), now: () => NOW })
    const unconfigured = await issue(signing, publicEnv({ DELEGATION_UID: '' }))
    expect(unconfigured.status).toBe(502)
  })
})
describe('branded passes for a self-serve right', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(ensNames)
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('renders the venue, card title, member number and brand colour on the web pass', async () => {
    const { app, bindings } = await setup()
    const res = await issue(app, bindings)
    const body = await res.json<SelfServeIssued>()
    const page = await app.request(`/pass/${body.uid}`, {}, bindings)
    const html = await page.text()
    expect(html).toContain('Wassie Coffee')
    expect(html).toContain('Membership Card')
    expect(html).toContain('--brand:#6F4320')
    expect(html).toContain(formatMemberNumber(body.memberNumber))
  })

  it('keeps the plain look for an admin-issued right', async () => {
    const { app, bindings } = await setup()
    const admin = await app.request(
      '/v1/issue',
      {
        body: JSON.stringify({ memberId: 'alice' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
      bindings,
    )
    const { uid } = await admin.json<{ uid: Hex }>()
    const page = await app.request(`/pass/${uid}`, {}, bindings)
    const html = await page.text()
    expect(html).not.toContain('Wassie Coffee')
    expect(html).toContain('fuda pass')
  })
})

describe('a venue with several cards', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(ensNames)
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  const venueWithoutCard = async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    const { card: firstCard, ...venueInput } = CARD_INPUT
    await postJson(app, publicEnv(), '/v1/issuers', venueInput, token)
    return { app, firstCard, token, venueInput }
  }

  it('refuses card creation when ENS is not configured', async () => {
    const { app, firstCard, token } = await venueWithoutCard()
    const unavailable = await postJson(app, publicEnv(), '/v1/issuers/cards', firstCard, token)
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toStrictEqual({ error: 'ens_not_configured' })
    await expect(getDb({ DB: env.DB }).select().from(cards)).resolves.toStrictEqual([])
  })

  it('refuses card creation while the ENS claim is only voucher-issued', async () => {
    const { app, firstCard, token, venueInput } = await venueWithoutCard()
    const configured = publicEnv({ ENS_PARENT_NAME: 'fuda.eth' })
    await mirrorIssuerName(getDb({ DB: env.DB }), {
      handle: venueInput.handle,
      now: NOW,
      owner: operator.address,
      parentName: 'fuda.eth',
      status: 'voucher_issued',
    })
    const required = await postJson(app, configured, '/v1/issuers/cards', firstCard, token)
    expect(required.status).toBe(409)
    await expect(required.json()).resolves.toStrictEqual({ error: 'ens_required' })
    await expect(getDb({ DB: env.DB }).select().from(cards)).resolves.toStrictEqual([])
  })

  it('allows different card slugs after the ENS claim is confirmed', async () => {
    const { app, firstCard, token, venueInput } = await venueWithoutCard()
    const configured = publicEnv({ ENS_PARENT_NAME: 'fuda.eth' })
    await mirrorIssuerName(getDb({ DB: env.DB }), {
      claimTxHash: `0x${'ab'.repeat(32)}`,
      expiry: NOW + 3600,
      handle: venueInput.handle,
      now: NOW,
      owner: operator.address,
      parentName: 'fuda.eth',
      status: 'claimed',
    })
    const first = await postJson(app, configured, '/v1/issuers/cards', firstCard, token)
    const second = await postJson(app, configured, '/v1/issuers/cards', SECOND_CARD, token)
    expect([first.status, second.status]).toStrictEqual([201, 201])
    const stored = await getDb({ DB: env.DB }).select().from(cards)
    expect(stored.map((card) => card.slug).toSorted()).toStrictEqual(['gig', 'stamp'])
  })

  it('adds a second card to the same venue and lists both for the operator', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = publicEnv({ ENS_PARENT_NAME: 'fuda.eth' })
    const { token } = await signIn(app, bindings)
    await registerVenueWithCard(app, bindings, CARD_INPUT, token)
    const added = await postJson(app, bindings, '/v1/issuers/cards', SECOND_CARD, token)
    expect(added.status).toBe(201)
    const me = await getJson(app, bindings, '/v1/issuers/me', token)
    const body = await me.json<{ cards: { slug: string }[]; publicUrl: string }>()
    expect(body.cards.map((card) => card.slug)).toStrictEqual(['stamp', 'gig'])
    expect(body.publicUrl).toBe('https://fuda.test/@wassie-coffee')
  })

  it('refuses a duplicate slug and an invalid one', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = publicEnv({ ENS_PARENT_NAME: 'fuda.eth' })
    const { token } = await signIn(app, bindings)
    await registerVenueWithCard(app, bindings, CARD_INPUT, token)
    const duplicate = await postJson(
      app,
      bindings,
      '/v1/issuers/cards',
      { ...SECOND_CARD, slug: 'stamp' },
      token,
    )
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toStrictEqual({ error: 'slug_taken' })
    const reserved = await postJson(
      app,
      bindings,
      '/v1/issuers/cards',
      { ...SECOND_CARD, slug: 'cards' },
      token,
    )
    await expect(reserved.json()).resolves.toStrictEqual({ error: 'bad_slug' })
  })

  it('serves both cards on the venue page', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = publicEnv({ ENS_PARENT_NAME: 'fuda.eth' })
    const { token } = await signIn(app, bindings)
    await registerVenueWithCard(app, bindings, CARD_INPUT, token)
    await postJson(app, bindings, '/v1/issuers/cards', SECOND_CARD, token)
    const res = await getJson(app, bindings, '/v1/issuers/wassie-coffee')
    const venue = await res.json<{ cards: { slug: string; title: string }[] }>()
    expect(venue.cards.map((card) => card.slug)).toStrictEqual(['stamp', 'gig'])
    expect(venue.cards[1]?.title).toBe('Gig Ticket')
  })

  it('checks a slug against the venue that would own it', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = publicEnv()
    const { token } = await signIn(app, bindings)
    await registerVenueWithCard(app, bindings, CARD_INPUT, token)
    const taken = await getJson(app, bindings, '/v1/issuers/cards/check?slug=stamp', token)
    await expect(taken.json()).resolves.toStrictEqual({ available: false, slug: 'stamp', valid: true })
    const free = await getJson(app, bindings, '/v1/issuers/cards/check?slug=gig', token)
    await expect(free.json()).resolves.toStrictEqual({ available: true, slug: 'gig', valid: true })
  })

  it('issues each card under its own slug with numbers unique across the venue', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del, {
      API_BASE_URL: 'https://api.test',
      ENS_PARENT_NAME: 'fuda.eth',
      PUBLIC_BASE_URL: 'https://fuda.test',
    })
    const { token } = await signIn(app, bindings)
    await registerVenueWithCard(app, bindings, CARD_INPUT, token)
    await postJson(app, bindings, '/v1/issuers/cards', SECOND_CARD, token)
    const first = await app.request(
      '/v1/issuers/wassie-coffee/stamp/issue',
      { headers: { 'CF-Connecting-IP': '203.0.113.30' }, method: 'POST' },
      bindings,
    )
    const second = await app.request(
      '/v1/issuers/wassie-coffee/gig/issue',
      { headers: { 'CF-Connecting-IP': '203.0.113.30' }, method: 'POST' },
      bindings,
    )
    const a = await first.json<SelfServeIssued>()
    const b = await second.json<SelfServeIssued>()
    expect(a.memberNumber).not.toBe(b.memberNumber)
    expect(a.uid).not.toBe(b.uid)
    const rows = await getDb({ DB: env.DB }).select().from(members)
    expect(new Set(rows.map((row) => row.issuerId)).size).toBe(1)
    expect(new Set(rows.map((row) => row.cardId)).size).toBe(2)
  })

  it('answers 404 for a slug the venue does not publish', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del, { PUBLIC_BASE_URL: 'https://fuda.test' })
    const { token } = await signIn(app, bindings)
    await postJson(app, bindings, '/v1/issuers', CARD_INPUT, token)
    const res = await app.request(
      '/v1/issuers/wassie-coffee/gig/issue',
      { headers: { 'CF-Connecting-IP': '203.0.113.31' }, method: 'POST' },
      bindings,
    )
    expect(res.status).toBe(404)
  })
})

const venueWith = async (card: Partial<typeof SECOND_CARD>) => {
  const chain = fakeChain({ signer: ROOT })
  const del = seedRoot(chain)
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv(del, { ENS_PARENT_NAME: 'fuda.eth', PUBLIC_BASE_URL: 'https://fuda.test' })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(app, bindings, CARD_INPUT, token)
  await postJson(app, bindings, '/v1/issuers/cards', { ...SECOND_CARD, ...card }, token)
  return { app, bindings, chain }
}

const claimGig = async (app: ReturnType<typeof appWith>, bindings: Bindings, ip: string) =>
  await app.request(
    '/v1/issuers/wassie-coffee/gig/issue',
    { headers: { 'CF-Connecting-IP': ip }, method: 'POST' },
    bindings,
  )

describe('the card windows', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('refuses a claim before the window opens and after it closes', async () => {
    const early = await venueWith({ claimFrom: NOW + 60, claimUntil: null, validityDays: null })
    const closed = await claimGig(early.app, early.bindings, '203.0.113.50')
    expect(closed.status).toBe(409)
    await expect(closed.json()).resolves.toStrictEqual({ error: 'card_closed' })
    const late = await venueWith({ claimFrom: null, claimUntil: NOW - 1, validityDays: null })
    const shut = await claimGig(late.app, late.bindings, '203.0.113.51')
    expect(shut.status).toBe(409)
  })

  it('allows a claim inside the window and marks the card claimable', async () => {
    const open = await venueWith({ claimFrom: NOW - 60, claimUntil: NOW + 60, validityDays: null })
    const issued = await claimGig(open.app, open.bindings, '203.0.113.52')
    expect(issued.status).toBe(200)
    const page = await getJson(open.app, open.bindings, '/v1/issuers/wassie-coffee')
    const venue = await page.json<{ cards: { claimable: boolean; slug: string }[] }>()
    expect(venue.cards.find((entry) => entry.slug === 'gig')?.claimable).toBe(true)
  })

  it('reports a closed card on the venue page instead of hiding it', async () => {
    const past = await venueWith({ claimUntil: NOW - 1, validityDays: null })
    const page = await getJson(past.app, past.bindings, '/v1/issuers/wassie-coffee')
    const venue = await page.json<{ cards: { claimable: boolean; slug: string }[] }>()
    expect(venue.cards.map((entry) => entry.slug)).toStrictEqual(['stamp', 'gig'])
    expect(venue.cards.find((entry) => entry.slug === 'gig')?.claimable).toBe(false)
    expect(venue.cards.find((entry) => entry.slug === 'stamp')?.claimable).toBe(true)
  })

  it('gives everyone the same absolute validity however early they claimed', async () => {
    const fixed = await venueWith({ validFrom: NOW + 1000, validUntil: NOW + 2000, validityDays: null })
    const first = await claimGig(fixed.app, fixed.bindings, '203.0.113.53')
    const body = await first.json<SelfServeIssued>()
    const raw = await fixed.chain.readAttestation(body.uid)
    expect(decodeEntitlementV1(raw.data)).toMatchObject({
      validFrom: BigInt(NOW + 1000),
      validUntil: BigInt(NOW + 2000),
    })
  })

  it('counts a relative validity from the claim, not from a fixed date', async () => {
    const relative = await venueWith({ validityDays: 90 })
    const issued = await claimGig(relative.app, relative.bindings, '203.0.113.54')
    const body = await issued.json<SelfServeIssued>()
    const raw = await relative.chain.readAttestation(body.uid)
    expect(decodeEntitlementV1(raw.data)).toMatchObject({
      validFrom: 0n,
      validUntil: BigInt(NOW + 90 * 86_400),
    })
  })

  it('refuses a card that sets both validity shapes at once', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del, { PUBLIC_BASE_URL: 'https://fuda.test' })
    const { token } = await signIn(app, bindings)
    await postJson(app, bindings, '/v1/issuers', CARD_INPUT, token)
    const both = await postJson(
      app,
      bindings,
      '/v1/issuers/cards',
      { ...SECOND_CARD, validFrom: NOW, validUntil: NOW + 10, validityDays: 30 },
      token,
    )
    expect(both.status).toBe(400)
    await expect(both.json()).resolves.toStrictEqual({ error: 'bad_input' })
  })
})
