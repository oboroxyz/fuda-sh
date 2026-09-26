import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FakeChain } from '../src/chain/fake-chain.ts'
import { getDb } from '../src/db/client.ts'
import { badges } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRight, seedRoot, worldProof as proofFor } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const worldEnv = (bindings: ReturnType<typeof configuredEnv>) => ({
  ...bindings,
  WORLD_ACTION: 'ethtokyo2026-human',
  WORLD_APP_ID: 'app_test',
  WORLD_RP_ID: 'rp_test',
  WORLD_RP_SIGNING_KEY: `0x${'11'.repeat(32)}`,
})

// A distinct IP per request keeps the hourly rate-limit budget from bleeding
// between tests; the route requires `CF-Connecting-IP` before it runs at all.
let ipCounter = 0
const nextIp = (): string => {
  ipCounter += 1
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`
}

const post = async (path: string, body: unknown, bindings: Bindings, chain: FakeChain = fakeChain()) =>
  await appWith({ chain, now: () => NOW }).request(
    path,
    {
      body: JSON.stringify(body),
      headers: { 'CF-Connecting-IP': nextIp(), 'content-type': 'application/json' },
      method: 'POST',
    },
    bindings,
  )

const stubPortal = (response: { success: boolean; nullifier?: string }, status = 200) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Response.json(response, { status })),
  )
}

describe('badge routes', () => {
  beforeEach(async () => {
    await db().delete(badges)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST /v1/badges/:kind/context', () => {
    it('answers 501 when World is not configured', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const res = await post('/v1/badges/human/context', {}, configuredEnv(del), chain)
      expect(res.status).toBe(501)
      await expect(res.json()).resolves.toStrictEqual({ error: 'badges_not_configured' })
    })

    it('rejects an unknown kind', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const res = await post('/v1/badges/nonsense/context', {}, worldEnv(configuredEnv(del)), chain)
      expect(res.status).toBe(404)
    })

    it('returns a signed context and never the signing key, with cache-control: no-store', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const res = await post('/v1/badges/human/context', {}, worldEnv(configuredEnv(del)), chain)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = JSON.stringify(await res.clone().json())
      expect(body).not.toContain('11'.repeat(32))
    })
  })

  describe('POST /v1/badges/:kind', () => {
    it('answers 501 when World is not configured', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const bindings = configuredEnv(del)
      const res = await post(
        '/v1/badges/human',
        { payload: {}, uid: `0x${'a1'.repeat(32)}` },
        bindings,
        chain,
      )
      expect(res.status).toBe(501)
      await expect(res.json()).resolves.toStrictEqual({ error: 'badges_not_configured' })
    })

    it('rejects an unknown kind', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const res = await post(
        '/v1/badges/nonsense',
        { payload: {}, uid: `0x${'a1'.repeat(32)}` },
        worldEnv(configuredEnv(del)),
        chain,
      )
      expect(res.status).toBe(404)
    })

    it('rejects a malformed uid before calling the portal', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const fetchSpy = vi.fn<() => void>()
      vi.stubGlobal('fetch', fetchSpy)
      const res = await post(
        '/v1/badges/human',
        { payload: {}, uid: 'nope' },
        worldEnv(configuredEnv(del)),
        chain,
      )
      expect(res.status).toBe(400)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('answers 404 for a revoked or unknown Right', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      // A second root delegation so the chain holds more than one attestation;
      // the point of this test is the *requested* uid never having been seeded.
      seedRoot(chain)
      const unknownUid = `0x${'99'.repeat(32)}`
      stubPortal({ nullifier: '0xdead', success: true })
      const res = await post(
        '/v1/badges/human',
        { payload: proofFor(unknownUid), uid: unknownUid },
        worldEnv(configuredEnv(del)),
        chain,
      )
      expect(res.status).toBe(404)
    })

    it('rejects a proof whose signal is not the requested uid', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const uid = seedRight(chain, del)
      const otherUid = `0x${'77'.repeat(32)}`
      stubPortal({ nullifier: '0xdead', success: true })
      const res = await post(
        '/v1/badges/human',
        { payload: proofFor(otherUid), uid },
        worldEnv(configuredEnv(del)),
        chain,
      )
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toStrictEqual({ error: 'bad_input' })
    })

    it('writes a badge row when the portal accepts the proof', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const uid = seedRight(chain, del)
      const bindings = worldEnv(configuredEnv(del))

      stubPortal({ nullifier: '0xdead', success: true })
      const res = await post('/v1/badges/human', { payload: proofFor(uid), uid }, bindings, chain)
      expect(res.status).toBe(200)
      await expect(db().select().from(badges)).resolves.toHaveLength(1)
    })

    it('is idempotent: the same call again answers 200 with the same body and no second row', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const uid = seedRight(chain, del)
      const bindings = worldEnv(configuredEnv(del))

      stubPortal({ nullifier: '0xdead', success: true })
      const first = await post('/v1/badges/human', { payload: proofFor(uid), uid }, bindings, chain)
      const firstBody: unknown = await first.json()

      stubPortal({ nullifier: '0xdead', success: true })
      const repeat = await post('/v1/badges/human', { payload: proofFor(uid), uid }, bindings, chain)
      expect(repeat.status).toBe(200)
      await expect(repeat.json()).resolves.toStrictEqual(firstBody)
      await expect(db().select().from(badges)).resolves.toHaveLength(1)
    })

    it('rejects the same nullifier claimed against a second Right with 409 already_badged', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const uid1 = seedRight(chain, del)
      const uid2 = seedRight(chain, del)
      const bindings = worldEnv(configuredEnv(del))

      stubPortal({ nullifier: '0xdead', success: true })
      await post('/v1/badges/human', { payload: proofFor(uid1), uid: uid1 }, bindings, chain)

      stubPortal({ nullifier: '0xdead', success: true })
      const res = await post('/v1/badges/human', { payload: proofFor(uid2), uid: uid2 }, bindings, chain)
      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toStrictEqual({ error: 'already_badged' })
    })

    it('rejects a different nullifier against a Right that already carries a badge with 409 pass_already_badged', async () => {
      const chain = fakeChain()
      const del = seedRoot(chain)
      const uid = seedRight(chain, del)
      const bindings = worldEnv(configuredEnv(del))

      stubPortal({ nullifier: '0xdead', success: true })
      await post('/v1/badges/human', { payload: proofFor(uid), uid }, bindings, chain)

      stubPortal({ nullifier: '0xbeef', success: true })
      const res = await post('/v1/badges/human', { payload: proofFor(uid), uid }, bindings, chain)
      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toStrictEqual({ error: 'pass_already_badged' })
    })
  })
})
