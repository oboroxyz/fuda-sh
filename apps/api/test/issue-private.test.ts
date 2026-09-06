import { deriveMemberSecret, deriveStealthKeys, matchAnnouncements } from '@fuda/stealth'
import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChainError } from '../src/chain/client.ts'
import { getDb } from '../src/db/client.ts'
import { challenges, entryLog, members, slots } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRoot } from './fixtures.ts'

type App = ReturnType<typeof appWith>
const db = () => getDb({ DB: env.DB })
const keys = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(3)))
// Shape-valid (132 hex) but not two compressed points: 0xff is not a point tag.
const OFF_CURVE = `0x${'ff'.repeat(66)}`

interface IssuedPrivate {
  uid: Hex
  level: string
  announced: boolean
  announceTx: Hex
}

const setup = () => {
  const chain = fakeChain()
  const del = seedRoot(chain)
  return { app: appWith({ chain, now: () => NOW }), bindings: configuredEnv(del), chain }
}

const post = async (app: App, bindings: Bindings, path: string, body: unknown): Promise<Response> =>
  await app.request(
    path,
    { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )

// Issue a +Private right and read the response body, so the tests that only
// need the uid do not reach through the awaited Response.
const issued = async (app: App, bindings: Bindings, body: unknown): Promise<IssuedPrivate> => {
  const res = await post(app, bindings, '/issue', body)
  const out: IssuedPrivate = await res.json()
  return out
}

describe('POST /issue (+Private)', () => {
  beforeEach(async () => {
    await db().delete(members)
    await db().delete(challenges)
    await db().delete(slots)
    await db().delete(entryLog)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('attests to a fresh stealth address, announces it, and answers without passUrls or the address', async () => {
    const { app, bindings, chain } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress, tier: 2 })
    expect(res.status).toBe(200)
    const body: IssuedPrivate = await res.json()
    expect(body).toMatchObject({ announced: true, level: 'private' })
    expect(body).not.toHaveProperty('passUrls')
    expect(body).not.toHaveProperty('holder')
    expect(chain.announcements).toHaveLength(1)
  })

  it('answers exactly the four private fields and announces under scheme 1 with the uid in the metadata', async () => {
    const { app, bindings, chain } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    const body: IssuedPrivate = await res.json()
    expect(Object.keys(body).toSorted()).toStrictEqual(['announceTx', 'announced', 'level', 'uid'])
    expect(chain.announcements[0]).toMatchObject({ schemeId: 1, txHash: body.announceTx })
    // metadata = 0x + one view-tag byte + the uid, so discovery carries the right it points at.
    expect(chain.announcements[0]?.metadata).toMatch(new RegExp(`^0x[0-9a-f]{2}${body.uid.slice(2)}$`, 'u'))
  })

  it('stores a row with holder NULL and the representative id', async () => {
    const { app, bindings } = setup()
    const res = await post(app, bindings, '/issue', {
      memberId: 'alice',
      stealthMetaAddress: keys.metaAddress,
    })
    const { uid }: IssuedPrivate = await res.json()
    const rows = await db().select().from(members)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ attestationUid: uid, holder: null, level: 'private', memberId: 'alice' })
  })

  it('stores an empty member id when none is given', async () => {
    const { app, bindings } = setup()
    await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    const rows = await db().select().from(members)
    expect(rows[0]?.memberId).toBe('')
  })

  it('reports the private row with a null holder on GET /members', async () => {
    const { app, bindings } = setup()
    await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    const listed = await app.request('/members', {}, bindings)
    await expect(listed.json()).resolves.toMatchObject({ members: [{ holder: null, level: 'private' }] })
  })

  it('is discoverable and enterable by the member with the recovered stealth key', async () => {
    const { app, bindings, chain } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress, usageModel: 0 })
    const { uid }: IssuedPrivate = await res.json()
    const found = matchAnnouncements(keys, chain.announcements)
    expect(found.map((f) => f.uid)).toStrictEqual([uid])
    const account = privateKeyToAccount(found[0]?.stealthPrivateKey ?? '0x')
    const challengeRes = await post(app, bindings, '/challenge', { uid })
    const minted: { challenge: string; nonce: Hex } = await challengeRes.json()
    const signature = await account.signMessage({ message: minted.challenge })
    const entered = await post(app, bindings, '/verify-signed', { nonce: minted.nonce, signature, uid })
    await expect(entered.json()).resolves.toMatchObject({
      decision: 'ADMIT',
      holder: account.address,
      path: 'signature',
    })
  })

  it('rejects a +Private right presented by QR with LEVEL_REQUIRED', async () => {
    const { app, bindings } = setup()
    const { uid } = await issued(app, bindings, { stealthMetaAddress: keys.metaAddress })
    const res = await post(app, bindings, '/verify', { qr: `fuda:v1:${uid}` })
    await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
  })

  it('answers 404 for the pass page of a +Private right', async () => {
    const { app, bindings } = setup()
    const { uid } = await issued(app, bindings, { stealthMetaAddress: keys.metaAddress })
    const res = await app.request(`/pass/${uid}`, {}, bindings)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toStrictEqual({ error: 'not_found' })
  })

  it('answers 400 bad_meta_address for a malformed meta-address', async () => {
    const { app, bindings } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: '0x1234' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_meta_address' })
  })

  it('answers 400 bad_meta_address for a shape-valid meta-address that is not on the curve', async () => {
    const { app, bindings } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: OFF_CURVE })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_meta_address' })
  })

  it('answers 400 bad_input when holder is also supplied', async () => {
    const { app, bindings } = setup()
    const res = await post(app, bindings, '/issue', {
      holder: `0x${'11'.repeat(20)}`,
      stealthMetaAddress: keys.metaAddress,
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_input' })
  })

  it('answers 502 chain_error with no row when the announce fails after the attest', async () => {
    const { app, bindings, chain } = setup()
    chain.failAnnounce = true
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
    await expect(db().select().from(members)).resolves.toHaveLength(0)
    // The root delegation plus the orphaned right: the attest did land, and
    // nothing was announced for it.
    expect(chain.attestations.size).toBe(2)
    expect(chain.announcements).toHaveLength(0)
  })

  it('logs the failed announce without the stealth address', async () => {
    const { app, bindings, chain } = setup()
    let stealth = ''
    // Shaped like a viem write failure: the failing call's arguments (the stealth
    // address among them) sit past the first 120 characters of the message and in
    // a nested property, so logging the error object or an untruncated message
    // would leak the one value +Private must not put in a log sink.
    chain.announce = async (p) => {
      stealth = p.stealthAddress
      const error = new ChainError(
        `${'the contract function reverted. '.repeat(6)}args: (1, ${p.stealthAddress})`,
      )
      error.cause = { args: [p.stealthAddress] }
      return await Promise.reject(error)
    }
    const spy = vi.spyOn(console, 'error').mockReturnValue()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    const logged = JSON.stringify(spy.mock.calls).toLowerCase()
    expect(res.status).toBe(502)
    expect(logged).not.toContain(stealth.toLowerCase())
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ name: 'ChainError' })
  })

  it('answers 502 chain_error with no row and no announcement when the attest fails', async () => {
    const { app, bindings, chain } = setup()
    chain.failWrites = true
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
    await expect(db().select().from(members)).resolves.toHaveLength(0)
    expect(chain.announcements).toHaveLength(0)
  })
})
