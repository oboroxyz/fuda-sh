import { env } from 'cloudflare:test'
import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { entryLog } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW, ROOT, seedRight, seedRoot } from './fixtures.ts'

describe('GET /verify/:uid', () => {
  it('400 bad_uid on a malformed uid', async () => {
    const chain = fakeChain()
    const res = await appWith({ chain, now: () => NOW }).request(
      '/verify/0x123',
      {},
      configuredEnv(seedRoot(chain)),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_uid' })
  })

  it('returns the verdict with entitlement + delegation and never logs', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const res = await appWith({ chain, now: () => NOW }).request(`/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({
      decision: 'ADMIT',
      delegation: { active: true, issuer: getAddress(ROOT), name: 'fuda root' },
      entitlement: {
        holder: getAddress(HOLDER),
        issuer: getAddress(ROOT),
        level: 0,
        schemaVersion: 1,
        tier: 1,
        usageModel: 1,
        validFrom: 0,
        validUntil: 0,
      },
      reason: 'OK',
    })
    const rows = await getDb({ DB: env.DB }).select().from(entryLog)
    expect(rows).toHaveLength(0)
  })

  it('reports level >= 1 as ADMIT (preview never rejects on level)', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { level: 1 })
    const res = await appWith({ chain, now: () => NOW }).request(`/verify/${uid}`, {}, configuredEnv(del))
    const body = await res.json()
    expect(body).toMatchObject({ decision: 'ADMIT', entitlement: { level: 1 } })
  })

  it('REVOKED is a 200 REJECT verdict', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.revokeAt(uid, 5n)
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request(`/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'REVOKED' })
  })

  it('NOT_FOUND is a 200 REJECT verdict', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request(`/verify/0x${'ee'.repeat(32)}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'NOT_FOUND' })
  })

  it('502 chain_error when the Entitlement read fails', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.failReads = true
    const res = await appWith({ chain, now: () => NOW }).request(`/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
  })

  it('502 chain_error when EAS_SCHEMAS is malformed', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const badEnv = configuredEnv(del, { EAS_SCHEMAS: 'not json' })
    const res = await appWith({ chain, now: () => NOW }).request(`/verify/${uid}`, {}, badEnv)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
  })
})
