import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, challenges, issuers, members, sessions } from '../src/db/schema.ts'
import { decodeEntitlementV1 } from '../src/eas/codecs.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { configuredEnv, NOW, other, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, getJson, postJson, signIn } from './operator.ts'

interface Created {
  issuer: { id: string; handle: string; brandColor: string; operatorAddress: string }
  card: { id: string; title: string; category: string; validityDays: number | null }
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
    '/issuers/wassie-coffee/issue',
    { headers: { 'CF-Connecting-IP': ip }, method: 'POST' },
    bindings,
  )

describe('issuer onboarding', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('creates the issuer and first card and binds the session to it', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    const res = await postJson(app, publicEnv(), '/issuers', CARD_INPUT, token)
    expect(res.status).toBe(201)
    const body = await res.json<Created>()
    expect(body.issuer.brandColor).toBe('#6F4320')
    expect(body.publicUrl).toBe('https://fuda.test/@wassie-coffee')
    const me = await getJson(app, publicEnv(), '/issuers/me', token)
    await expect(me.json()).resolves.toStrictEqual(body)
  })

  it('finds the issuer again on the next sign-in', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const first = await signIn(app, publicEnv())
    await postJson(app, publicEnv(), '/issuers', CARD_INPUT, first.token)
    const second = await signIn(app, publicEnv())
    expect(second.issuer).toMatchObject({ handle: 'wassie-coffee' })
    const me = await getJson(app, publicEnv(), '/issuers/me', second.token)
    await expect(me.json()).resolves.toMatchObject({ card: { title: 'Membership Card' } })
  })

  it('rejects a bad handle, a taken handle and a second issuer', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    const bad = await postJson(app, publicEnv(), '/issuers', { ...CARD_INPUT, handle: 'Auth' }, token)
    await expect(bad.json()).resolves.toStrictEqual({ error: 'bad_handle' })
    await postJson(app, publicEnv(), '/issuers', CARD_INPUT, token)
    const again = await postJson(app, publicEnv(), '/issuers', { ...CARD_INPUT, handle: 'second' }, token)
    await expect(again.json()).resolves.toStrictEqual({ error: 'issuer_exists' })
    const { token: otherToken } = await signIn(app, publicEnv(), other)
    const taken = await postJson(app, publicEnv(), '/issuers', CARD_INPUT, otherToken)
    expect(taken.status).toBe(409)
    await expect(taken.json()).resolves.toStrictEqual({ error: 'handle_taken' })
  })

  it('checks handle availability for a signed-in operator only', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    await postJson(app, publicEnv(), '/issuers', CARD_INPUT, token)
    const taken = await getJson(app, publicEnv(), '/issuers/check?handle=wassie-coffee', token)
    await expect(taken.json()).resolves.toStrictEqual({
      available: false,
      handle: 'wassie-coffee',
      valid: true,
    })
    const free = await getJson(app, publicEnv(), '/issuers/check?handle=wassie-tea', token)
    await expect(free.json()).resolves.toStrictEqual({ available: true, handle: 'wassie-tea', valid: true })
    const reserved = await getJson(app, publicEnv(), '/issuers/check?handle=api', token)
    await expect(reserved.json()).resolves.toStrictEqual({ available: false, handle: 'api', valid: false })
    const anonymous = await getJson(app, publicEnv(), '/issuers/check?handle=x')
    expect(anonymous.status).toBe(401)
  })

  it('serves the public card without the operator address', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, publicEnv())
    await postJson(app, publicEnv(), '/issuers', CARD_INPUT, token)
    const res = await getJson(app, publicEnv(), '/issuers/wassie-coffee')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json<{ brandColor: string; handle: string; name: string }>()
    expect(body).toMatchObject({ brandColor: '#6F4320', handle: 'wassie-coffee', name: 'Wassie Coffee' })
    expect(JSON.stringify(body)).not.toContain('operatorAddress')
    const missing = await getJson(app, publicEnv(), '/issuers/nobody')
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
  await postJson(app, bindings, '/issuers', { ...CARD_INPUT, card: { ...CARD_INPUT.card, ...card } }, token)
  return { app, bindings, chain }
}

describe('POST /issuers/:handle/issue', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
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
      '/issuers/nobody/issue',
      { headers: { 'CF-Connecting-IP': '203.0.113.9' }, method: 'POST' },
      bindings,
    )
    expect(unknown.status).toBe(404)
    const noIp = await app.request('/issuers/wassie-coffee/issue', { method: 'POST' }, bindings)
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
    await postJson(app, bindings, '/issuers', CARD_INPUT, token)
    const noSigner = await issue(app, bindings)
    expect(noSigner.status).toBe(501)
    const signing = appWith({ chain: fakeChain({ signer: ROOT }), now: () => NOW })
    const unconfigured = await issue(signing, publicEnv({ DELEGATION_UID: '' }))
    expect(unconfigured.status).toBe(502)
  })
})
