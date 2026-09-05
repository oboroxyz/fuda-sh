import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { challenges } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { consumeChallenge } from '../src/verify/challenge.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRoot } from './fixtures.ts'

type App = ReturnType<typeof appWith>
const db = () => getDb({ DB: env.DB })
const UID = `0x${'ab'.repeat(32)}` as const

const mint = async (app: App, bindings: Bindings, uid: string): Promise<Response> =>
  await app.request(
    '/challenge',
    { body: JSON.stringify({ uid }), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )

describe('POST /challenge', () => {
  beforeEach(async () => {
    await db().delete(challenges)
  })

  it('mints a one-time nonce without consulting the chain', async () => {
    const chain = fakeChain()
    chain.failReads = true
    const del = seedRoot(chain)
    const res = await mint(appWith({ chain, now: () => NOW }), configuredEnv(del), UID)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body: { challenge: string; nonce: string } = await res.json()
    expect(body.nonce).toMatch(/^0x[0-9a-f]{32}$/u)
    expect(body.challenge).toBe(`fuda-gate:${UID}:${body.nonce}`)
  })

  it('stores the nonce against the normalized uid with created_at = now', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const res = await mint(
      appWith({ chain, now: () => NOW }),
      configuredEnv(del),
      UID.toUpperCase().replace('0X', '0x'),
    )
    const body: { nonce: string } = await res.json()
    const rows = await db().select().from(challenges)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ createdAt: NOW, nonce: body.nonce, uid: UID, usedAt: null })
  })

  it('answers 400 bad_uid for a malformed uid', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const res = await mint(appWith({ chain, now: () => NOW }), configuredEnv(del), '0x12')
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_uid' })
    await expect(db().select().from(challenges)).resolves.toHaveLength(0)
  })

  it('mints distinct nonces for the same uid', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const resA = await mint(app, configuredEnv(del), UID)
    const resB = await mint(app, configuredEnv(del), UID)
    const a: { nonce: string } = await resA.json()
    const b: { nonce: string } = await resB.json()
    expect(a.nonce).not.toBe(b.nonce)
  })
})

describe(consumeChallenge, () => {
  beforeEach(async () => {
    await db().delete(challenges)
  })

  const nonce = `0x${'cd'.repeat(16)}` as const

  it('consumes an unused, fresh nonce exactly once', async () => {
    await db().insert(challenges).values({ createdAt: NOW, nonce, uid: UID })
    await expect(consumeChallenge(db(), { nonce, now: NOW + 10, uid: UID })).resolves.toBe(true)
    await expect(consumeChallenge(db(), { nonce, now: NOW + 11, uid: UID })).resolves.toBe(false)
    const rows = await db().select().from(challenges)
    expect(rows[0]?.usedAt).toBe(NOW + 10)
  })

  it('refuses a nonce minted for another uid, or older than the TTL', async () => {
    await db().insert(challenges).values({ createdAt: NOW, nonce, uid: UID })
    await expect(consumeChallenge(db(), { nonce, now: NOW + 10, uid: `0x${'ee'.repeat(32)}` })).resolves.toBe(
      false,
    )
    await expect(consumeChallenge(db(), { nonce, now: NOW + 300, uid: UID })).resolves.toBe(false)
    await expect(consumeChallenge(db(), { nonce, now: NOW + 299, uid: UID })).resolves.toBe(true)
  })
})
