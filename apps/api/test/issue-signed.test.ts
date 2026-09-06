import { env } from 'cloudflare:test'
import { getAddress } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { entryLog, members, slots } from '../src/db/schema.ts'
import { decodeEntitlementV1 } from '../src/eas/codecs.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot, signer } from './fixtures.ts'

type App = ReturnType<typeof appWith>
const db = () => getDb({ DB: env.DB })

const post = async (app: App, bindings: Bindings, path: string, body: unknown): Promise<Response> =>
  await app.request(
    path,
    { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )

interface Issued {
  uid: `0x${string}`
  level: string
  holder: string
  qr: string
  passUrls: Record<string, string>
}

describe('POST /issue (signed)', () => {
  beforeEach(async () => {
    await db().delete(members)
    await db().delete(slots)
    await db().delete(entryLog)
  })

  it('issues a level-1 right to the given wallet and mirrors holder into member_id', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const lower = signer.address.toLowerCase()
    const res = await post(appWith({ chain, now: () => NOW }), configuredEnv(del), '/issue', {
      holder: lower,
      tier: 1,
    })
    expect(res.status).toBe(200)
    const body: Issued = await res.json()
    expect(body).toMatchObject({
      holder: getAddress(signer.address),
      level: 'signed',
      qr: `fuda:v1:${body.uid}`,
    })
    const rows = await db().select().from(members)
    expect(rows[0]).toMatchObject({
      holder: getAddress(signer.address),
      level: 'signed',
      memberId: getAddress(signer.address),
      status: 'active',
    })
  })

  it('encodes level 1 and attests to the wallet as recipient', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const res = await post(appWith({ chain, now: () => NOW }), configuredEnv(del), '/issue', {
      holder: signer.address,
    })
    const body: Issued = await res.json()
    const raw = await chain.readAttestation(body.uid)
    expect(raw.recipient).toBe(getAddress(signer.address))
    expect(decodeEntitlementV1(raw.data)).toMatchObject({ holder: getAddress(signer.address), level: 1 })
  })

  it('returns all three pass URLs like a Bearer right', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const res = await post(
      appWith({ chain, now: () => NOW }),
      configuredEnv(del, { API_BASE_URL: 'https://api.test' }),
      '/issue',
      { holder: signer.address },
    )
    const body: Issued = await res.json()
    expect(Object.keys(body.passUrls).toSorted()).toStrictEqual(['apple', 'google', 'web'])
    expect(body.passUrls.web).toBe(`https://api.test/pass/${body.uid}`)
  })

  // A Signed right by QR → LEVEL_REQUIRED and its SINGLE_USE slot stays unconsumed.
  it('rejects the same right by QR with LEVEL_REQUIRED and leaves its slot unconsumed', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    const issueRes = await post(app, bindings, '/issue', { holder: signer.address, usageModel: 0 })
    const issued: Issued = await issueRes.json()
    const scan = await post(app, bindings, '/verify', { qr: issued.qr })
    await expect(scan.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
    await expect(db().select().from(slots)).resolves.toHaveLength(0)
  })

  it('issues a right that GET /verify/:uid ADMITs with level 1', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    const issueRes = await post(app, bindings, '/issue', { holder: signer.address })
    const issued: Issued = await issueRes.json()
    const res = await app.request(`/verify/${issued.uid}`, {}, bindings)
    expect(res.status).toBe(200)
    const verdict: { decision: string; entitlement: { level: number } } = await res.json()
    expect(verdict.decision).toBe('ADMIT')
    expect(verdict.entitlement.level).toBe(1)
  })

  it('still answers 400 bad_input for holder + memberId together', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const res = await post(appWith({ chain, now: () => NOW }), configuredEnv(del), '/issue', {
      holder: signer.address,
      memberId: 'x',
    })
    expect(res.status).toBe(400)
  })
})
