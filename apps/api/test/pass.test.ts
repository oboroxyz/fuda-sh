import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
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
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(body).toContain('data-ok="true">VALID<')
    expect(body).toContain('VIP')
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
})
