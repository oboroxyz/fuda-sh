import { challengeMessage } from '@fuda/sdk'
import { createExecutionContext, env } from 'cloudflare:test'
import { getAddress } from 'viem'
import type { Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { attendanceHook } from '../src/attendance/attendance-hook.ts'
import { ChainError } from '../src/chain/client.ts'
import { getDb } from '../src/db/client.ts'
import { challenges, entryLog, members, slots } from '../src/db/schema.ts'
import { parseSchemaSets } from '../src/eas/schemas.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, other, seedRight, seedRoot, signer } from './fixtures.ts'

type App = ReturnType<typeof appWith>
const db = () => getDb({ DB: env.DB })

const post = async (
  app: App,
  bindings: Bindings,
  path: string,
  body: unknown,
  ctx?: ExecutionContext,
): Promise<Response> =>
  await app.request(
    path,
    { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
    ctx,
  )

const mint = async (app: App, bindings: Bindings, uid: Hex): Promise<{ challenge: string; nonce: Hex }> => {
  const res = await post(app, bindings, '/challenge', { uid })
  return await res.json()
}

// The whole member-side flow against a real key: challenge → sign → verify.
const enter = async (app: App, bindings: Bindings, uid: Hex, key = signer): Promise<Response> => {
  const { challenge, nonce } = await mint(app, bindings, uid)
  const signature = await key.signMessage({ message: challenge })
  return await post(app, bindings, '/verify-signed', { nonce, signature, uid })
}

const setup = (over: Parameters<typeof seedRight>[2] = {}) => {
  const chain = fakeChain()
  const del = seedRoot(chain)
  const uid = seedRight(chain, del, { holder: signer.address, level: 1, ...over })
  return { app: appWith({ chain, now: () => NOW }), bindings: configuredEnv(del), chain, del, uid }
}

describe('POST /verify-signed', () => {
  beforeEach(async () => {
    await db().delete(challenges)
    await db().delete(slots)
    await db().delete(entryLog)
    await db().delete(members)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ADMITs a Signed right whose holder signed the challenge', async () => {
    const { app, bindings, uid } = setup()
    const res = await enter(app, bindings, uid)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toStrictEqual({
      decision: 'ADMIT',
      holder: getAddress(signer.address),
      path: 'signature',
      reason: 'OK',
    })
  })

  it('logs the ADMIT with path signature', async () => {
    const { app, bindings, uid } = setup()
    await enter(app, bindings, uid)
    const log = await db().select().from(entryLog)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ at: NOW, decision: 'ADMIT', path: 'signature', reason: 'OK', uid })
  })

  it('rejects BAD_SIGNATURE for another key and still burns the challenge', async () => {
    const { app, bindings, uid } = setup()
    const res = await enter(app, bindings, uid, other)
    await expect(res.json()).resolves.toStrictEqual({
      decision: 'REJECT',
      holder: getAddress(signer.address),
      path: 'signature',
      reason: 'BAD_SIGNATURE',
    })
    const rows = await db().select().from(challenges)
    expect(rows[0]?.usedAt).toBe(NOW)
  })

  it('logs the BAD_SIGNATURE rejection', async () => {
    const { app, bindings, uid } = setup()
    await enter(app, bindings, uid, other)
    const log = await db().select().from(entryLog)
    expect(log[0]).toMatchObject({ decision: 'REJECT', path: 'signature', reason: 'BAD_SIGNATURE', uid })
  })

  it('rejects a replayed nonce with BAD_CHALLENGE at stage challenge', async () => {
    const { app, bindings, uid } = setup()
    const { challenge, nonce } = await mint(app, bindings, uid)
    const signature = await signer.signMessage({ message: challenge })
    await post(app, bindings, '/verify-signed', { nonce, signature, uid })
    const replay = await post(app, bindings, '/verify-signed', { nonce, signature, uid })
    await expect(replay.json()).resolves.toStrictEqual({
      decision: 'REJECT',
      holder: getAddress(signer.address),
      path: 'signature',
      reason: 'BAD_CHALLENGE',
      stage: 'challenge',
    })
  })

  it('rejects an expired nonce (TTL 300 s) with BAD_CHALLENGE', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { holder: signer.address, level: 1 })
    const bindings = configuredEnv(del)
    const { challenge, nonce } = await mint(appWith({ chain, now: () => NOW }), bindings, uid)
    const signature = await signer.signMessage({ message: challenge })
    const later = appWith({ chain, now: () => NOW + 300 })
    const res = await post(later, bindings, '/verify-signed', { nonce, signature, uid })
    await expect(res.json()).resolves.toMatchObject({ reason: 'BAD_CHALLENGE', stage: 'challenge' })
  })

  it('rejects a revoked right at stage entitlement, logged, before touching the challenge', async () => {
    const { app, bindings, chain, uid } = setup()
    chain.revokeAt(uid, 5n)
    const { challenge, nonce } = await mint(app, bindings, uid)
    const signature = await signer.signMessage({ message: challenge })
    const res = await post(app, bindings, '/verify-signed', { nonce, signature, uid })
    await expect(res.json()).resolves.toStrictEqual({
      decision: 'REJECT',
      holder: getAddress(signer.address),
      path: 'signature',
      reason: 'REVOKED',
      stage: 'entitlement',
    })
    const log = await db().select().from(entryLog)
    expect(log[0]).toMatchObject({ decision: 'REJECT', path: 'signature', reason: 'REVOKED' })
    const rows = await db().select().from(challenges)
    expect(rows[0]?.usedAt).toBeNull()
  })

  it('omits holder when nothing was decoded (unknown uid rejects NOT_FOUND)', async () => {
    const { app, bindings } = setup()
    const unknown = `0x${'99'.repeat(32)}` as const
    const { nonce } = await mint(app, bindings, unknown)
    const signature = await signer.signMessage({ message: challengeMessage(unknown, nonce) })
    const res = await post(app, bindings, '/verify-signed', { nonce, signature, uid: unknown })
    await expect(res.json()).resolves.toStrictEqual({
      decision: 'REJECT',
      path: 'signature',
      reason: 'NOT_FOUND',
      stage: 'entitlement',
    })
  })

  it('SINGLE_USE admits once by signature and rejects ALREADY_USED the second time', async () => {
    const { app, bindings, uid } = setup({ usageModel: 0 })
    const first = await enter(app, bindings, uid)
    await expect(first.json()).resolves.toMatchObject({ decision: 'ADMIT' })
    const second = await enter(app, bindings, uid)
    await expect(second.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'ALREADY_USED' })
    await expect(db().select().from(slots)).resolves.toHaveLength(1)
    // Both verdicts are logged on the signature path: the ADMIT that took the
    // slot and the REJECT that found it burned.
    const logged = await db().select().from(entryLog).orderBy(entryLog.id)
    expect(logged.map((row) => [row.decision, row.reason, row.path])).toStrictEqual([
      ['ADMIT', 'OK', 'signature'],
      ['REJECT', 'ALREADY_USED', 'signature'],
    ])
  })

  it('admits a level-0 right by signature too (/verify-signed accepts every level)', async () => {
    const { app, bindings, uid } = setup({ level: 0 })
    const res = await enter(app, bindings, uid)
    await expect(res.json()).resolves.toMatchObject({ decision: 'ADMIT', reason: 'OK' })
  })

  it('answers 400 bad_uid / bad_input for malformed fields and logs nothing', async () => {
    const { app, bindings } = setup()
    const nonce = `0x${'cd'.repeat(16)}`
    const bad = await post(app, bindings, '/verify-signed', { nonce, signature: '0x00', uid: '0x12' })
    const badNonce = await post(app, bindings, '/verify-signed', {
      nonce: '0x12',
      signature: '0x00',
      uid: `0x${'ab'.repeat(32)}`,
    })
    expect([bad.status, badNonce.status]).toStrictEqual([400, 400])
    await expect(bad.json()).resolves.toStrictEqual({ error: 'bad_uid' })
    await expect(badNonce.json()).resolves.toStrictEqual({ error: 'bad_input' })
    await expect(db().select().from(entryLog)).resolves.toHaveLength(0)
  })

  it('answers 502 chain_error when the chain is unreachable and logs nothing', async () => {
    const { app, bindings, chain, uid } = setup()
    chain.failReads = true
    const res = await post(app, bindings, '/verify-signed', {
      nonce: `0x${'cd'.repeat(16)}`,
      signature: '0x00',
      uid,
    })
    expect(res.status).toBe(502)
    await expect(db().select().from(entryLog)).resolves.toHaveLength(0)
  })

  // A ChainError out of the signature check itself. FakeChain fails closed;
  // production viem folds a transport failure into `false` (see ChainClient),
  // so this path is exercised by the fake, not by a real RPC outage.
  it('answers 502 chain_error when the signature check itself cannot reach the chain', async () => {
    const { app, bindings, chain, uid } = setup()
    const { challenge, nonce } = await mint(app, bindings, uid)
    const signature = await signer.signMessage({ message: challenge })
    vi.spyOn(chain, 'verifyMessage').mockRejectedValue(new ChainError('rpc down'))
    const res = await post(app, bindings, '/verify-signed', { nonce, signature, uid })
    expect(res.status).toBe(502)
    await expect(db().select().from(entryLog)).resolves.toHaveLength(0)
    // The challenge is spent regardless: step 2 precedes step 3 for replay protection.
    const rows = await db().select().from(challenges)
    expect(rows[0]?.usedAt).toBe(NOW)
  })

  it('attests Attendance on a signature ADMIT through the same hook', async () => {
    const { bindings, chain, uid } = setup()
    const kept: Promise<unknown>[] = []
    const ctx = createExecutionContext()
    ctx.waitUntil = (p: Promise<unknown>) => {
      kept.push(p)
    }
    const app = appWith({
      chain,
      now: () => NOW,
      onAdmit: attendanceHook({ chain, db: db(), sets: parseSchemaSets(bindings.EAS_SCHEMAS) }),
    })
    const { challenge, nonce } = await mint(app, bindings, uid)
    const signature = await signer.signMessage({ message: challengeMessage(uid, nonce) })
    expect(challenge).toBe(challengeMessage(uid, nonce))
    await post(app, bindings, '/verify-signed', { nonce, signature, uid }, ctx)
    await Promise.all(kept)
    const log = await db().select().from(entryLog)
    expect(log[0]?.attendanceUid).toMatch(/^0x[0-9a-f]{64}$/u)
  })
})
