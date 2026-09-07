import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { challenges, issuers, sessions } from '../src/db/schema.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { NOW, other } from './fixtures.ts'
import { getJson, operator, postJson, signIn } from './operator.ts'

describe('operator sign-in', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(issuers)
  })

  it('mints a challenge whose message carries the nonce', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const res = await postJson(app, testEnv(), '/auth/challenge', { address: operator.address })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json<{ message: string; nonce: Hex }>()
    expect(body.message).toBe(`fuda.sh dashboard sign-in\nnonce: ${body.nonce}`)
  })

  it('rejects a malformed address', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const res = await postJson(app, testEnv(), '/auth/challenge', { address: 'operator' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_address' })
  })

  it('issues a session token for a valid signature and no issuer yet', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const session = await signIn(app, testEnv())
    expect(session.token).toMatch(/^[0-9a-f]{64}$/u)
    expect(session.issuer).toBeNull()
    const me = await getJson(app, testEnv(), '/issuers/me', session.token)
    expect(me.status).toBe(200)
    await expect(me.json()).resolves.toStrictEqual({ cards: [], ens: null, issuer: null, publicUrl: null })
  })

  it('rejects a signature from another key and burns the nonce', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const challenge = await postJson(app, testEnv(), '/auth/challenge', { address: operator.address })
    const { message, nonce } = await challenge.json<{ message: string; nonce: Hex }>()
    const signature = await other.signMessage({ message })
    const bad = await postJson(app, testEnv(), '/auth/verify', {
      address: operator.address,
      nonce,
      signature,
    })
    expect(bad.status).toBe(401)
    await expect(bad.json()).resolves.toStrictEqual({ error: 'bad_signature' })
    const good = await operator.signMessage({ message })
    const replay = await postJson(app, testEnv(), '/auth/verify', {
      address: operator.address,
      nonce,
      signature: good,
    })
    expect(replay.status).toBe(401)
    await expect(replay.json()).resolves.toStrictEqual({ error: 'bad_challenge' })
  })

  it('expires a challenge after the TTL', async () => {
    let now = NOW
    const app = appWith({ chain: fakeChain(), now: () => now })
    const challenge = await postJson(app, testEnv(), '/auth/challenge', { address: operator.address })
    const { message, nonce } = await challenge.json<{ message: string; nonce: Hex }>()
    const signature = await operator.signMessage({ message })
    now = NOW + 301
    const late = await postJson(app, testEnv(), '/auth/verify', {
      address: operator.address,
      nonce,
      signature,
    })
    expect(late.status).toBe(401)
    await expect(late.json()).resolves.toStrictEqual({ error: 'bad_challenge' })
  })

  it('stores only the token hash and rejects an expired or logged-out session', async () => {
    let now = NOW
    const app = appWith({ chain: fakeChain(), now: () => now })
    const { token } = await signIn(app, testEnv())
    const rows = await getDb({ DB: env.DB }).select().from(sessions)
    expect(rows.map((row) => row.tokenHash)).not.toContain(token)
    const out = await postJson(app, testEnv(), '/auth/logout', {}, token)
    await expect(out.json()).resolves.toStrictEqual({ loggedOut: true })
    const afterLogout = await getJson(app, testEnv(), '/issuers/me', token)
    expect(afterLogout.status).toBe(401)
    const { token: second } = await signIn(app, testEnv())
    now = NOW + 31 * 86_400
    const expired = await getJson(app, testEnv(), '/issuers/me', second)
    expect(expired.status).toBe(401)
  })

  it('does not accept the admin token on operator routes', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const res = await getJson(app, testEnv({ ADMIN_TOKEN: 'secret' }), '/issuers/me', 'secret')
    expect(res.status).toBe(401)
  })
})
