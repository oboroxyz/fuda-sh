import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'

type App = ReturnType<typeof appWith>

const db = () => getDb({ DB: env.DB })

const post = async (app: App, bindings: Bindings, path: string, body: unknown): Promise<Response> =>
  await app.request(
    path,
    { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )

const revoke = async (app: App, bindings: Bindings, uid: unknown): Promise<Response> =>
  await post(app, bindings, '/revoke', { uid })

describe('POST /revoke', () => {
  // Storage is shared across the tests in this file and FakeChain's uid counter
  // restarts per instance, so the members table starts empty for every test.
  beforeEach(async () => {
    await db().delete(members)
  })

  it('revokes on chain, marks the row revoked, and the QR then verifies REVOKED', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    const issueRes = await post(app, bindings, '/issue', { memberId: 'alice' })
    const issued: { uid: `0x${string}` } = await issueRes.json()
    const res = await revoke(app, bindings, issued.uid)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({ revoked: true, uid: issued.uid })
    const attestation = await chain.readAttestation(issued.uid)
    expect(attestation.revocationTime).not.toBe(0n)
    const rows = await db().select().from(members)
    expect(rows[0]?.status).toBe('revoked')
    const verifyRes = await post(app, bindings, '/verify', { qr: `fuda:v1:${issued.uid}` })
    await expect(verifyRes.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'REVOKED' })
  })

  it('400 bad_uid on a malformed uid', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await revoke(app, configuredEnv(del), '0x12')
    expect(res.status).toBe(400)
  })

  it('502 chain_error for an unknown uid, with the row untouched', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await revoke(app, configuredEnv(del), `0x${'ee'.repeat(32)}`)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
    const rows = await db().select().from(members)
    expect(rows).toHaveLength(0)
  })

  it('502 chain_error revoking an already-revoked uid', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    const issueRes = await post(app, bindings, '/issue', { memberId: 'alice' })
    const issued: { uid: string } = await issueRes.json()
    await revoke(app, bindings, issued.uid)
    const res = await revoke(app, bindings, issued.uid)
    expect(res.status).toBe(502)
  })

  it('501 no_signer when the deployment cannot sign', async () => {
    const noSigner = fakeChain({ signer: null })
    const del = seedRoot(noSigner)
    const app = appWith({ chain: noSigner, now: () => NOW })
    const res = await revoke(app, configuredEnv(del), `0x${'ee'.repeat(32)}`)
    expect(res.status).toBe(501)
  })

  it('401 without the admin token when one is set', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await revoke(app, configuredEnv(del, { ADMIN_TOKEN: 's' }), `0x${'ee'.repeat(32)}`)
    expect(res.status).toBe(401)
  })
})
