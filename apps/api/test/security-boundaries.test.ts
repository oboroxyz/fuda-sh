import type { Hex } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MEMBER_COOKIE } from '../../app/src/cookie-names.ts'
import { forwardMemberApi } from '../../app/src/server/member-api.ts'
import { getDb } from '../src/db/client.ts'
import { members, slots } from '../src/db/schema.ts'
import type { AppEnv } from '../src/env.ts'
import { registerDevice, updatedSerials } from '../src/pass/apple-registrations.ts'
import { applePassToken } from '../src/pass/apple-web-service.ts'
import { notifyPassesChanged } from '../src/pass/notify.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, postJson, registerVenueWithCard, signIn } from './operator.ts'
import { SoftwarePasskey } from './software-passkey.ts'

const db = getDb({ DB: env.DB })
const key = privateKeyToAccount(`0x${'21'.repeat(32)}`)
const jsonOf = async <T>(pending: Promise<Response>): Promise<T> => {
  const response = await pending
  return await response.json<T>()
}
const prepare = async () => {
  const chain = fakeChain({ signer: ROOT })
  const bindings = configuredEnv(seedRoot(chain), { API_BASE_URL: 'https://api.test' })
  const app = appWith({ chain, now: () => NOW })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(
    app,
    bindings,
    {
      ...CARD_INPUT,
      card: { ...CARD_INPUT.card, category: 'ticket', identity: 'sensitive', record: 'offchain' },
    },
    token,
  )
  const issued = await app.request(
    `/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}/issue`,
    {
      body: JSON.stringify({ holderAddress: key.address }),
      headers: { 'CF-Connecting-IP': '203.0.113.52', 'content-type': 'application/json' },
      method: 'POST',
    },
    bindings,
  )
  expect(issued.status).toBe(200)
  const pass = await issued.json<{ uid: Hex; qr: string }>()
  return { app, bindings, pass, token }
}
type World = Awaited<ReturnType<typeof prepare>>
const challengeFor = async (world: World, venue?: string) =>
  await jsonOf<{ challenge: string; nonce: Hex }>(
    postJson(world.app, world.bindings, '/v1/challenge', { uid: world.pass.uid, venue }),
  )
const present = async (world: World, minted: Awaited<ReturnType<typeof challengeFor>>, venue?: string) =>
  await jsonOf<{ decision: string; reason: string; venue?: string }>(
    postJson(world.app, world.bindings, '/v1/verify-signed', {
      nonce: minted.nonce,
      signature: await key.signMessage({ message: minted.challenge }),
      uid: world.pass.uid,
      venue,
    }),
  )
const googleKey = async (): Promise<string> => {
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
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCodePoint(...der))}\n-----END PRIVATE KEY-----`
}
const captureFetch = (): Request[] => {
  const requests: Request[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    return await Promise.resolve(
      request.url.includes('oauth2.googleapis.com')
        ? Response.json({ access_token: 'access' })
        : Response.json({ textModulesData: [] }),
    )
  })
  return requests
}

describe('account, Sensitive distribution and venue boundaries', () => {
  beforeEach(async () => {
    for (const table of [
      'apple_pass_registrations',
      'apple_pass_devices',
      'apple_pass_updates',
      'reception_requests',
      'stamp_credits',
      'stamp_adjustments',
      'entry_log',
      'slots',
      'member_secret_copies',
      'member_vaults',
      'member_passes',
      'offchain_attestations',
      'members',
      'card_stamp_settings',
      'cards',
      'sessions',
      'passkeys',
      'issuers',
      'accounts',
      'rate_limits',
      'passkey_challenges',
      'challenges',
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- fixture cleanup follows foreign-key order
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
  })
  afterEach(() => vi.unstubAllGlobals())

  it('refuses the wrong venue through QR and signed entry without consuming a ticket', async () => {
    const world = await prepare()
    const qr = await jsonOf(
      postJson(world.app, world.bindings, '/v1/verify', { qr: world.pass.qr, venue: 'other-venue' }),
    )
    const signed = await present(world, await challengeFor(world, 'other-venue'), 'other-venue')
    expect({ qr, signed, slots: await db.select().from(slots) }).toMatchObject({
      qr: { decision: 'REJECT', reason: 'WRONG_VENUE' },
      signed: { decision: 'REJECT', reason: 'WRONG_VENUE', venue: CARD_INPUT.handle },
      slots: [],
    })
  })

  it('revoking a Sensitive pass sends no request to Google, even for an absent object', async () => {
    const { app, bindings, pass, token } = await prepare()
    Object.assign(bindings, {
      GOOGLE_CLASS_ID: 'class',
      GOOGLE_ISSUER_ID: '338',
      GOOGLE_SA_EMAIL: 'sa@example.com',
      GOOGLE_SA_KEY_PEM: await googleKey(),
    })
    const requests = captureFetch()
    const pending: Promise<unknown>[] = []
    const res = await app.request(
      '/v1/revoke',
      {
        body: JSON.stringify({ uid: pass.uid }),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        method: 'POST',
      },
      bindings,
      {
        passThroughOnException() {},
        props: {},
        waitUntil: (p) => {
          pending.push(p)
        },
      },
    )
    await Promise.all(pending)
    expect({ requests, status: res.status }).toStrictEqual({ requests: [], status: 200 })
  })

  it('a stolen operator session cannot enroll a key to reset the member vault', async () => {
    const rp = { origin: 'https://app.fuda.sh', rpId: 'fuda.sh' }
    const victim = new SoftwarePasskey(rp)
    const attacker = new SoftwarePasskey(rp)
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = configuredEnv(seedRoot(fakeChain()), {
      WEBAUTHN_ORIGINS: rp.origin,
      WEBAUTHN_RP_ID: rp.rpId,
    })
    const send = async (path: string, body: unknown, token = '', method = 'POST') =>
      await app.request(
        path,
        {
          body: JSON.stringify(body),
          headers: {
            'CF-Connecting-IP': '203.0.113.98',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          method,
        },
        bindings,
      )
    const options = await jsonOf<{ challenge: string }>(send('/v1/auth/member/register/options', {}))
    const member = await jsonOf<{ token: string }>(
      send('/v1/auth/member/register', await victim.attest(options.challenge)),
    )
    const copy = await send(
      '/v1/member/secret',
      {
        ciphertext: 'wrapped',
        credentialId: victim.credentialId,
        first: true,
        iv: 'AAAAAAAAAAAAAAAA',
        writeToken: 'A'.repeat(43),
      },
      member.token,
    )
    const vault = await send(
      '/v1/member/vault',
      { ciphertext: 'sealed', expectedVersion: 0, iv: 'AAAAAAAAAAAAAAAA', writeToken: 'A'.repeat(43) },
      member.token,
      'PUT',
    )
    expect({ copy: copy.status, vault: vault.status }).toStrictEqual({ copy: 200, vault: 200 })
    const loginOptions = await jsonOf<{ challenge: string }>(send('/v1/auth/operator/login/options', {}))
    const operator = await jsonOf<{ token: string }>(
      send('/v1/auth/operator/login', await victim.assert(loginOptions.challenge)),
    )
    const addOptions = await jsonOf<{ challenge: string }>(
      send('/v1/auth/operator/passkeys/options', {}, operator.token),
    )
    const added = await send(
      '/v1/auth/operator/passkeys',
      await attacker.attest(addOptions.challenge),
      operator.token,
    )
    expect(added.status).toBe(403)
    const attackerOptions = await jsonOf<{ challenge: string }>(send('/v1/auth/member/login/options', {}))
    const login = await send('/v1/auth/member/login', await attacker.assert(attackerOptions.challenge))
    expect(login.status).toBe(401)
    const after = await app.request(
      '/v1/member/vault',
      { headers: { authorization: `Bearer ${member.token}` } },
      bindings,
    )
    await expect(after.json()).resolves.toMatchObject({ vault: { ciphertext: 'sealed' } })
  })

  it('the proxy drops credentials on Sensitive claim, challenge and presentation, retaining venue', async () => {
    const sent = captureFetch()
    const proxy = new Hono()
    proxy.all('/api/*', async (c) => await forwardMemberApi(c, 'https://api.test'))
    for (const path of ['/challenge', '/verify-signed', '/issuers/coffee/card/issue']) {
      // oxlint-disable-next-line no-await-in-loop -- each public proxy route must independently drop credentials
      await proxy.request(`/api/v1${path}`, {
        body: JSON.stringify({ holderAddress: key.address, uid: `0x${'22'.repeat(32)}`, venue: 'coffee' }),
        headers: {
          authorization: 'Bearer browser-secret',
          'content-type': 'application/json',
          cookie: `${MEMBER_COOKIE}=cookie-secret`,
        },
        method: 'POST',
      })
    }
    expect(sent).toHaveLength(3)
    expect(sent.every((r) => !r.headers.has('authorization') && !r.headers.has('cookie'))).toBe(true)
    await expect(sent[0]?.json()).resolves.toMatchObject({ venue: 'coffee' })
  })

  it.each([undefined, CARD_INPUT.handle])('cannot replace a challenge venue with %s', async (venue) => {
    const world = await prepare()
    const minted = await challengeFor(world, 'other-venue')
    expect(minted.challenge).toContain(':venue=other-venue')
    await expect(present(world, minted, venue)).resolves.toMatchObject({
      decision: 'REJECT',
      reason: 'BAD_CHALLENGE',
      venue: CARD_INPUT.handle,
    })
    await expect(db.select().from(slots)).resolves.toHaveLength(0)
  })

  it.each([undefined, CARD_INPUT.handle])(
    'admits a matching venue %s and returns the actual issuer',
    async (venue) => {
      const world = await prepare()
      const minted = await challengeFor(world, venue)
      await expect(present(world, minted, venue)).resolves.toMatchObject({
        decision: 'ADMIT',
        venue: CARD_INPUT.handle,
      })
      await expect(db.select().from(slots)).resolves.toHaveLength(1)
      await expect(present(world, minted, venue)).resolves.toMatchObject({ reason: 'BAD_CHALLENGE' })
    },
  )

  it('refuses all Sensitive Wallet downloads and Apple registrations without external requests', async () => {
    const { app, bindings, pass } = await prepare()
    Object.assign(bindings, { APPLE_PASS_TYPE_ID: 'pass.test', APPLE_WEB_SERVICE_SECRET: 'secret' })
    const requests = captureFetch()
    const downloads = await Promise.all(
      ['', '/google', '/apple.pkpass', '/backup'].map(async (suffix) => {
        const res = await app.request(`/pass/${pass.uid}${suffix}`, {}, bindings)
        return res.status
      }),
    )
    const authorization = `ApplePass ${await applePassToken('secret', pass.uid)}`
    const registration = await app.request(
      `/apple/v1/devices/device/registrations/pass.test/${pass.uid}`,
      {
        body: JSON.stringify({ pushToken: 'ab' }),
        headers: { authorization, 'content-type': 'application/json' },
        method: 'POST',
      },
      bindings,
    )
    const unregistration = await app.request(
      `/apple/v1/devices/device/registrations/pass.test/${pass.uid}`,
      { headers: { authorization }, method: 'DELETE' },
      bindings,
    )
    const download = await app.request(
      `/apple/v1/passes/pass.test/${pass.uid}`,
      { headers: { authorization } },
      bindings,
    )
    expect({
      downloads,
      pass: download.status,
      registration: registration.status,
      requests,
      unregistration: unregistration.status,
    }).toStrictEqual({
      downloads: [404, 404, 404, 404],
      pass: 404,
      registration: 404,
      requests: [],
      unregistration: 404,
    })
  })

  it.each(['card', 'issuer'] as const)(
    'a %s update never pushes or lists a planted Sensitive Apple registration',
    async (scope) => {
      const { bindings, pass } = await prepare()
      const member = await db.select().from(members).where(eq(members.attestationUid, pass.uid)).get()
      await registerDevice(env.DB, {
        deviceId: 'device',
        now: NOW,
        pushToken: 'ab',
        serial: pass.uid,
        uid: pass.uid,
      })
      const requests = captureFetch()
      const pushed = vi.fn<NonNullable<AppEnv['Variables']['applePush']>>()
      const pending: Promise<unknown>[] = []
      const notify = new Hono<AppEnv>()
      notify.post('/', (c) => {
        c.set('db', db)
        c.set('now', () => NOW)
        c.set('applePush', pushed)
        notifyPassesChanged(
          c,
          scope === 'card' ? { cardId: member?.cardId ?? '' } : { issuerId: member?.issuerId ?? '' },
        )
        return c.body(null, 200)
      })
      Object.assign(bindings, { APPLE_PASS_TYPE_ID: 'pass.test', APPLE_WEB_SERVICE_SECRET: 'secret' })
      await notify.request('/', { method: 'POST' }, bindings, {
        passThroughOnException() {},
        props: {},
        waitUntil: (p) => {
          pending.push(p)
        },
      })
      await Promise.all(pending)
      expect(pushed).not.toHaveBeenCalled()
      expect(requests).toStrictEqual([])
      await expect(updatedSerials(env.DB, 'device', 0)).resolves.toBeNull()
    },
  )
})
