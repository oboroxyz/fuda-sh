import type { GoogleJwtClaims } from '@fuda/pass'
import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, issuers, members } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

const insertMember = async (uid: Hex, tier = 2): Promise<void> => {
  await db()
    .insert(members)
    .values({ attestationUid: uid, createdAt: NOW, holder: HOLDER, level: 'bearer', memberId: 'alice', tier })
}

describe('GET /pass/:uid', () => {
  beforeEach(async () => {
    await db().delete(members)
  })

  it('renders a self-contained pass page with the QR and live status', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    expect([res.status, res.headers.get('content-type')]).toStrictEqual([
      200,
      expect.stringContaining('text/html'),
    ])
    const body = await res.text()
    expect(body).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(body).toContain('data-ok="true">VALID<')
    expect(body).toContain('VIP')
  })

  it.each([
    ['iPhone', true, false],
    ['Android', false, true],
    ['Windows NT 10.0', false, false],
  ])('offers only the device wallet selected by the %s UA', async (userAgent, apple, google) => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(
      `/pass/${uid}`,
      { headers: { 'user-agent': userAgent } },
      configuredEnv(del),
    )
    const body = await res.text()
    expect([body.includes('Add to Apple Wallet'), body.includes('Add to Google Wallet')]).toStrictEqual([
      apple,
      google,
    ])
    expect(body).toContain(`fuda:v1:${uid}`)
  })

  it('carries the QR payload and loads no external assets', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    const body = await res.text()
    expect(body).toContain(`fuda:v1:${uid}`)
    expect(body).not.toMatch(/\s(?:src|href)=/u)
  })

  it('is never cached: the page carries the live status', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  // D1 stores the uid lower case, so an upper-case one from a pasted URL must be
  // folded at the route entry or the page 404s on a right that exists.
  it('renders the same pass for an upper-case uid', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    const upper = `0x${uid.slice(2).toUpperCase()}`
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${upper}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toContain(`fuda:v1:${uid}`)
  })

  it('shows REVOKED on the pass of a revoked right', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.revokeAt(uid, 5n)
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    await expect(res.text()).resolves.toContain('data-ok="false">REVOKED<')
  })

  it('still renders (status UNKNOWN) when the chain is down and never 5xxs', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    chain.failReads = true
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toContain('data-ok="unknown">UNKNOWN<')
  })

  it('answers 404 not_found for a uid fuda never issued, and 400 bad_uid for junk', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const missing = await app.request(`/pass/0x${'cd'.repeat(32)}`, {}, configuredEnv(del))
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toStrictEqual({ error: 'not_found' })
    const junk = await app.request('/pass/nope', {}, configuredEnv(del))
    expect(junk.status).toBe(400)
  })

  it('answers 404 for a private row: a +Private right has no pass', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid: Hex = `0x${'77'.repeat(32)}`
    await db().insert(members).values({
      attestationUid: uid,
      createdAt: NOW,
      holder: null,
      level: 'private',
      memberId: '',
      status: 'active',
      tier: 0,
    })
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toStrictEqual({ error: 'not_found' })
  })

  it('answers 501 for the wallet platforms until they are configured', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const app = appWith({ chain, now: () => NOW })
    const google = await app.request(`/pass/${uid}/google`, {}, configuredEnv(del))
    const apple = await app.request(`/pass/${uid}/apple.pkpass`, {}, configuredEnv(del))
    expect([google.status, apple.status]).toStrictEqual([501, 501])
    await expect(google.json()).resolves.toStrictEqual({ error: 'google_not_configured' })
    await expect(apple.json()).resolves.toStrictEqual({ error: 'apple_not_configured' })
  })

  it('offers the Add to Google Wallet button, hidden until the endpoint answers', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(
      `/pass/${uid}`,
      { headers: { 'user-agent': 'Android' } },
      configuredEnv(del),
    )
    await expect(res.text()).resolves.toContain('id="gw"')
  })
})

interface WalletKeys {
  publicKey: CryptoKey
  pem: string
}

// A throwaway service-account key: the JWT the route mints is verified against
// its public half, so the test proves a real RS256 signature, not a shape.
// Generated on first use and memoized — generating it is the slow part.
let keysOnce: Promise<WalletKeys> | null = null

const generateKeys = async (): Promise<WalletKeys> => {
  const pair = await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  )
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const body = btoa(String.fromCodePoint(...der))
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  }
}

const walletKeys = async (): Promise<WalletKeys> => {
  keysOnce ??= generateKeys()
  return await keysOnce
}

const fromBase64url = (segment: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(segment.replaceAll('-', '+').replaceAll('_', '/'))
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.codePointAt(i) ?? 0
  }
  return out
}

const googleEnv = async (del: Hex): Promise<Bindings> => {
  const keys = await walletKeys()
  return configuredEnv(del, {
    GOOGLE_CLASS_ID: '3388000000000000001.fuda-membership',
    GOOGLE_ISSUER_ID: '3388000000000000001',
    GOOGLE_SA_EMAIL: 'wallet@fuda.iam.gserviceaccount.com',
    GOOGLE_SA_KEY_PEM: keys.pem,
  })
}

const SAVE_BASE = 'https://pay.google.com/gp/v/save/'

const saveJwt = (body: unknown): string[] => {
  const { saveUrl } = body as { saveUrl: string }
  expect(saveUrl.startsWith(SAVE_BASE)).toBe(true)
  return saveUrl.slice(SAVE_BASE.length).split('.')
}

const claimsOf = (segment: string): GoogleJwtClaims =>
  JSON.parse(new TextDecoder().decode(fromBase64url(segment))) as GoogleJwtClaims

describe('GET /pass/:uid/google', () => {
  beforeEach(async () => {
    await db().delete(members)
  })

  it('mints a save link signed with the service-account key', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(
      `/pass/${uid}/google`,
      {},
      await googleEnv(del),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const [head, claims, sig] = saveJwt(await res.json())
    const keys = await walletKeys()
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      keys.publicKey,
      fromBase64url(sig ?? ''),
      new TextEncoder().encode(`${head}.${claims}`),
    )
    expect(ok).toBe(true)
  })

  it('claims the savetowallet audience and the api, dash and app origins', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const env_ = await googleEnv(del)
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}/google`, {}, env_)
    const [, claims] = saveJwt(await res.json())
    const decoded = claimsOf(claims ?? '')
    expect(decoded.aud).toBe('google')
    expect(decoded.typ).toBe('savetowallet')
    expect(decoded.iss).toBe('wallet@fuda.iam.gserviceaccount.com')
    expect(decoded.origins).toStrictEqual([
      new URL(env_.API_BASE_URL).origin,
      'https://dash.fuda.sh',
      'https://app.fuda.sh',
    ])
  })

  it('carries the pass object: issuer-scoped id, class and QR payload', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(
      `/pass/${uid}/google`,
      {},
      await googleEnv(del),
    )
    const [, claims] = saveJwt(await res.json())
    const [obj] = claimsOf(claims ?? '').payload.genericObjects
    expect(obj?.id).toBe(`3388000000000000001.${uid.slice(2)}`)
    expect(obj?.classId).toBe('3388000000000000001.fuda-membership')
    expect(obj?.barcode.value).toBe(`fuda:v1:${uid}`)
    expect(obj?.header.defaultValue.value).toBe('VIP')
  })

  it('is 501 when a required GOOGLE_* secret is missing', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const partial = { ...(await googleEnv(del)), GOOGLE_SA_EMAIL: undefined }
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}/google`, {}, partial)
    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toStrictEqual({ error: 'google_not_configured' })
  })

  // A bad secret is a configuration problem, not an internal defect.
  it('is 501, not 5xx, when the configured PEM cannot be imported', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const broken = { ...(await googleEnv(del)), GOOGLE_SA_KEY_PEM: 'not a key' }
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}/google`, {}, broken)
    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toStrictEqual({ error: 'google_not_configured' })
  })

  it('is 400 for a junk uid and 404 for one fuda never issued', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const env_ = await googleEnv(del)
    const junk = await app.request('/pass/nope/google', {}, env_)
    const missing = await app.request(`/pass/0x${'cd'.repeat(32)}/google`, {}, env_)
    expect([junk.status, missing.status]).toStrictEqual([400, 404])
    await expect(junk.json()).resolves.toStrictEqual({ error: 'bad_uid' })
    await expect(missing.json()).resolves.toStrictEqual({ error: 'not_found' })
  })

  // 404 precedes the platform check: a private row must never reveal whether a
  // wallet platform is configured.
  it('is 404 for a private row even with all four secrets set', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid: Hex = `0x${'78'.repeat(32)}`
    await db().insert(members).values({
      attestationUid: uid,
      createdAt: NOW,
      holder: null,
      level: 'private',
      memberId: '',
      status: 'active',
      tier: 0,
    })
    const app = appWith({ chain, now: () => NOW })
    const env_ = await googleEnv(del)
    const google = await app.request(`/pass/${uid}/google`, {}, env_)
    const apple = await app.request(`/pass/${uid}/apple.pkpass`, {}, env_)
    expect([google.status, apple.status]).toStrictEqual([404, 404])
    await expect(google.json()).resolves.toStrictEqual({ error: 'not_found' })
    await expect(apple.json()).resolves.toStrictEqual({ error: 'not_found' })
  })
})

describe('GET /pass/:uid/card', () => {
  beforeEach(async () => {
    await db().delete(members)
    await db().delete(cards)
    await db().delete(issuers)
  })

  it('answers the venue card behind a self-serve right, in display form', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await db().insert(issuers).values({
      brandColor: '#112233',
      createdAt: NOW,
      handle: 'coffee',
      id: 'venue',
      logoPrefix: 'coffee/abc',
      name: 'Wassie Coffee',
      operatorAddress: HOLDER,
    })
    await db().insert(cards).values({
      category: 'membership',
      createdAt: NOW,
      id: 'card',
      issuerId: 'venue',
      slug: 'members',
      title: 'Members',
    })
    await db().insert(members).values({
      attestationUid: uid,
      cardId: 'card',
      createdAt: NOW,
      holder: HOLDER,
      issuerId: 'venue',
      level: 'bearer',
      memberId: 'qj2yxphepdrka',
      tier: 0,
    })
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}/card`, {}, configuredEnv(del))
    expect([res.status, res.headers.get('cache-control')]).toStrictEqual([200, 'no-store'])
    await expect(res.json()).resolves.toStrictEqual({
      card: {
        brandColor: '#112233',
        cardTitle: 'Members',
        category: 'membership',
        issuerName: 'Wassie Coffee',
        logoUrl: 'https://api.fuda.sh/assets/coffee/logo/master?v=/abc',
        memberNumber: 'QJ2Y-XPHE-PDRKA',
      },
    })
  })

  it('answers card: null for an admin-issued right, which keeps the plain look', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}/card`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({ card: null })
  })

  it('answers 404 for a private row and for a uid fuda never issued', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid: Hex = `0x${'77'.repeat(32)}`
    await db().insert(members).values({
      attestationUid: uid,
      createdAt: NOW,
      holder: null,
      level: 'private',
      memberId: '',
      status: 'active',
      tier: 0,
    })
    const app = appWith({ chain, now: () => NOW })
    const hidden = await app.request(`/pass/${uid}/card`, {}, configuredEnv(del))
    const missing = await app.request(`/pass/0x${'cd'.repeat(32)}/card`, {}, configuredEnv(del))
    expect([hidden.status, missing.status]).toStrictEqual([404, 404])
  })
})
