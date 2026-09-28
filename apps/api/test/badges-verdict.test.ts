import type { VerifyResponse } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { saveBadge } from '../src/badges/store.ts'
import { getDb } from '../src/db/client.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

describe('badges in the verdict', () => {
  it('carries a saved badge in the verdict body', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await saveBadge(db(), {
      credential: 'orb',
      expiresAt: null,
      kind: 'human',
      scope: 'ethtokyo2026',
      subjectKey: '0xdead',
      uid,
      verifiedAt: NOW,
      verifier: 'world',
    })
    const res = await appWith({ chain, now: () => NOW }).request(`/v1/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      badges: [{ at: NOW, kind: 'human', verifier: 'world' }],
      decision: 'ADMIT',
    })
  })

  it('omits the badges key entirely for an unbadged right', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const res = await appWith({ chain, now: () => NOW }).request(`/v1/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    const body: VerifyResponse = await res.json()
    expect(body.decision).toBe('ADMIT')
    expect(body).not.toHaveProperty('badges')
  })

  it('a dropped badge store never fails the scan, only omits badges', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await env.DB.exec('DROP TABLE badges')
    const res = await appWith({ chain, now: () => NOW }).request(`/v1/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    const body: VerifyResponse = await res.json()
    expect(body.decision).toBe('ADMIT')
    expect(body).not.toHaveProperty('badges')
  })
})
