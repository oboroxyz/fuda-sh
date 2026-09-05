import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { getAddress } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import { decodeEntitlementV1 } from '../src/eas/codecs.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, ENT, NOW, ROOT, seedRoot } from './fixtures.ts'

interface IssuedBody {
  uid: Hex
  level: string
  holder: Hex
  qr: string
  passUrls: Record<string, string>
}

type App = ReturnType<typeof appWith>

const post = async (app: App, bindings: Bindings, body: unknown): Promise<Response> =>
  await app.request(
    '/issue',
    { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )

const issued = async (res: Response): Promise<IssuedBody> => await res.json()

describe('POST /issue (bearer)', () => {
  // Storage is shared across the tests in this file and FakeChain's uid counter
  // restarts per instance, so the members table starts empty for every test.
  beforeEach(async () => {
    await getDb({ DB: env.DB }).delete(members)
  })

  it('returns the uid, level, qr and all three pass URLs', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await post(app, configuredEnv(del, { API_BASE_URL: 'https://api.test' }), {
      memberId: 'alice',
      tier: 2,
    })
    expect(res.status).toBe(200)
    const body = await issued(res)
    expect(body.level).toBe('bearer')
    expect(body.qr).toBe(`fuda:v1:${body.uid}`)
    expect(body.passUrls).toStrictEqual({
      apple: `https://api.test/pass/${body.uid}/apple.pkpass`,
      google: `https://api.test/pass/${body.uid}/google`,
      web: `https://api.test/pass/${body.uid}`,
    })
  })

  it('attests the Entitlement to the Claimable smart account with level 0', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const res = await post(appWith({ chain, now: () => NOW }), configuredEnv(del), {
      memberId: 'alice',
      tier: 2,
    })
    const body = await issued(res)
    const raw = await chain.readAttestation(body.uid)
    expect(raw.schema).toBe(ENT)
    expect(raw.refUID).toBe(del)
    expect(raw.recipient).toBe(body.holder)
    expect(decodeEntitlementV1(raw.data)).toMatchObject({
      holder: body.holder,
      issuer: getAddress(ROOT),
      level: 0,
      metaURI: '',
      tier: 2,
      usageModel: 1,
      validFrom: 0n,
      validUntil: 0n,
    })
  })

  it('stores the members row only after the receipt', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const res = await post(appWith({ chain, now: () => NOW }), configuredEnv(del), {
      memberId: 'alice',
      tier: 2,
    })
    const body = await issued(res)
    const rows = await getDb({ DB: env.DB }).select().from(members)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      attestationUid: body.uid,
      createdAt: NOW,
      holder: body.holder,
      level: 'bearer',
      memberId: 'alice',
      status: 'active',
      tier: 2,
    })
  })

  it('issues a right that GET /verify/:uid ADMITs with level 0', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    const body = await issued(await post(app, bindings, { memberId: 'alice' }))
    const res = await app.request(`/verify/${body.uid}`, {}, bindings)
    expect(res.status).toBe(200)
    const verdict: { decision: string; entitlement: { level: number } } = await res.json()
    expect(verdict.decision).toBe('ADMIT')
    expect(verdict.entitlement.level).toBe(0)
  })

  it('issues twice for the same memberId: two rights, one holder', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    const a = await issued(await post(app, bindings, { memberId: 'bob' }))
    const b = await issued(await post(app, bindings, { memberId: 'bob' }))
    expect(a.uid).not.toBe(b.uid)
    expect(a.holder).toBe(b.holder)
    await expect(getDb({ DB: env.DB }).select().from(members)).resolves.toHaveLength(2)
  })

  it('400 bad_input on validation failure, on both keys and on an empty body', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    // holder + memberId together is malformed under every kind; a lone holder
    // is now a well-formed Signed request (covered by test/issue-signed.test.ts).
    const bodies = [
      {},
      { holder: `0x${'11'.repeat(20)}`, memberId: 'a' },
      { memberId: 'a', tier: 9 },
      { memberId: '' },
    ]
    const responses = await Promise.all(bodies.map(async (body) => await post(app, configuredEnv(del), body)))
    const payloads = await Promise.all(responses.map(async (res) => await res.json()))
    expect(responses.map((res) => res.status)).toStrictEqual([400, 400, 400, 400])
    expect(payloads).toStrictEqual(bodies.map(() => ({ error: 'bad_input' })))
  })

  it('501 no_signer when no signer is configured', async () => {
    const chain = fakeChain({ signer: null })
    const del = seedRoot(chain)
    const res = await post(appWith({ chain, now: () => NOW }), configuredEnv(del), { memberId: 'a' })
    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toStrictEqual({ error: 'no_signer' })
  })

  it('502 chain_error when the attest fails, persisting nothing', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    chain.failWrites = true
    const res = await post(appWith({ chain, now: () => NOW }), configuredEnv(del), { memberId: 'a' })
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
    await expect(getDb({ DB: env.DB }).select().from(members)).resolves.toHaveLength(0)
  })

  it('502 chain_error when ISSUER_ADDRESS or DELEGATION_UID is unconfigured', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const zeroIssuer = configuredEnv(del, { ISSUER_ADDRESS: `0x${'00'.repeat(20)}` })
    const zeroDelegation = configuredEnv(del, { DELEGATION_UID: `0x${'00'.repeat(32)}` })
    const badSchemas = configuredEnv(del, { EAS_SCHEMAS: 'nonsense' })
    const responses = await Promise.all(
      [zeroIssuer, zeroDelegation, badSchemas].map(
        async (bindings) => await post(app, bindings, { memberId: 'a' }),
      ),
    )
    expect(responses.map((res) => res.status)).toStrictEqual([502, 502, 502])
  })

  it('401 unauthorized when ADMIN_TOKEN is set and the token is missing or wrong', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del, { ADMIN_TOKEN: 'secret' })
    const missing = await post(app, bindings, { memberId: 'a' })
    const wrong = await app.request(
      '/issue',
      {
        body: JSON.stringify({ memberId: 'a' }),
        headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
        method: 'POST',
      },
      bindings,
    )
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    await expect(getDb({ DB: env.DB }).select().from(members)).resolves.toHaveLength(0)
  })
})
