import { env } from 'cloudflare:test'
import { getAddress } from 'viem'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { entryLog, slots } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import type { AdmitInfo } from '../src/verify/admit.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW, seedRight, seedRoot } from './fixtures.ts'

type App = ReturnType<typeof appWith>

const db = () => getDb({ DB: env.DB })

const scan = async (app: App, bindings: Bindings, qr: string): Promise<Response> =>
  await app.request(
    '/verify',
    { body: JSON.stringify({ qr }), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )

const scanJson = async (app: App, bindings: Bindings, qr: string): Promise<unknown> => {
  const res = await scan(app, bindings, qr)
  return await res.json()
}

describe('POST /verify', () => {
  // Storage is shared across the tests in this file, so both tables this file
  // writes start empty for every test.
  beforeEach(async () => {
    await db().delete(slots)
    await db().delete(entryLog)
  })

  it('400 bad_qr on a bare uid or a bad prefix', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const uid = seedRight(chain, del)
    const responses = await Promise.all(
      [uid, `fuda:v2:${uid}`, 'hello'].map(async (qr) => await scan(app, configuredEnv(del), qr)),
    )
    const bodies = await Promise.all(responses.map(async (res) => await res.json()))
    expect(responses.map((res) => res.status)).toStrictEqual([400, 400, 400])
    expect(bodies).toStrictEqual([{ error: 'bad_qr' }, { error: 'bad_qr' }, { error: 'bad_qr' }])
  })

  it('does not log a bad_qr request', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    await scan(appWith({ chain, now: () => NOW }), configuredEnv(del), 'hello')
    const rows = await db().select().from(entryLog)
    expect(rows).toHaveLength(0)
  })

  it('ADMITs a bearer right and logs the entry with path qr', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const res = await scan(appWith({ chain, now: () => NOW }), configuredEnv(del), `fuda:v1:${uid}`)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      decision: 'ADMIT',
      entitlement: { level: 0 },
      reason: 'OK',
    })
    const log = await db().select().from(entryLog)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      at: NOW,
      attendanceUid: null,
      decision: 'ADMIT',
      path: 'qr',
      reason: 'OK',
      uid,
    })
  })

  it('SINGLE_USE admits once and rejects ALREADY_USED the second time', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { usageModel: 0 })
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    await expect(scanJson(app, bindings, `fuda:v1:${uid}`)).resolves.toMatchObject({ decision: 'ADMIT' })
    await expect(scanJson(app, bindings, `fuda:v1:${uid}`)).resolves.toMatchObject({
      decision: 'REJECT',
      reason: 'ALREADY_USED',
    })
    const consumed = await db().select().from(slots)
    expect(consumed).toHaveLength(1)
    expect(consumed[0]).toMatchObject({ consumedAt: NOW, slot: 'default', uid })
  })

  it('logs both the SINGLE_USE ADMIT and the ALREADY_USED reject', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { usageModel: 0 })
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    await scan(app, bindings, `fuda:v1:${uid}`)
    await scan(app, bindings, `fuda:v1:${uid}`)
    const log = await db().select().from(entryLog)
    expect(log.map((r) => r.reason)).toStrictEqual(['OK', 'ALREADY_USED'])
    expect(log.map((r) => r.decision)).toStrictEqual(['ADMIT', 'REJECT'])
    expect(log.map((r) => r.path)).toStrictEqual(['qr', 'qr'])
  })

  it('MULTI_USE admits repeatedly without touching slots', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { usageModel: 1 })
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del)
    await expect(scanJson(app, bindings, `fuda:v1:${uid}`)).resolves.toMatchObject({ decision: 'ADMIT' })
    await expect(scanJson(app, bindings, `fuda:v1:${uid}`)).resolves.toMatchObject({ decision: 'ADMIT' })
    const consumed = await db().select().from(slots)
    expect(consumed).toHaveLength(0)
  })

  it('rejects LEVEL_REQUIRED for a level >= 1 right scanned by QR', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { level: 1, usageModel: 0 })
    const res = await scan(appWith({ chain, now: () => NOW }), configuredEnv(del), `fuda:v1:${uid}`)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      decision: 'REJECT',
      entitlement: { level: 1 },
      reason: 'LEVEL_REQUIRED',
    })
    const log = await db().select().from(entryLog)
    expect(log[0]).toMatchObject({ decision: 'REJECT', path: 'qr', reason: 'LEVEL_REQUIRED' })
  })

  it('checks the level before consuming the slot, so a photographed pass cannot burn it', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { level: 1, usageModel: 0 })
    await scan(appWith({ chain, now: () => NOW }), configuredEnv(del), `fuda:v1:${uid}`)
    const consumed = await db().select().from(slots)
    expect(consumed).toHaveLength(0)
  })

  it('logs a REVOKED right as a REJECT', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.revokeAt(uid, 5n)
    const app = appWith({ chain, now: () => NOW })
    await expect(scanJson(app, configuredEnv(del), `fuda:v1:${uid}`)).resolves.toMatchObject({
      decision: 'REJECT',
      reason: 'REVOKED',
    })
    const log = await db().select().from(entryLog)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ decision: 'REJECT', path: 'qr', reason: 'REVOKED', uid })
  })

  it('answers 502 chain_error on a chain read failure and logs nothing', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.failReads = true
    const res = await scan(appWith({ chain, now: () => NOW }), configuredEnv(del), `fuda:v1:${uid}`)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
    const log = await db().select().from(entryLog)
    expect(log).toHaveLength(0)
  })

  it('calls onAdmit once with the entry log id and a waitUntil on ADMIT', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const calls: AdmitInfo[] = []
    const app = appWith({
      chain,
      now: () => NOW,
      onAdmit: (info) => {
        calls.push(info)
      },
    })
    await scan(app, configuredEnv(del), `fuda:v1:${uid}`)
    const log = await db().select().from(entryLog)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ entryLogId: log[0]?.id, holder: getAddress(HOLDER), now: NOW, uid })
    expect(calls[0]?.waitUntil).toBeTypeOf('function')
  })

  // Attendance is best-effort (spec §8): a throwing hook must not turn an
  // admission into a 500.
  it('still ADMITs and logs the entry when onAdmit throws', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const app = appWith({
      chain,
      now: () => NOW,
      onAdmit: () => {
        throw new Error('attendance backend down')
      },
    })
    const res = await scan(app, configuredEnv(del), `fuda:v1:${uid}`)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ decision: 'ADMIT', reason: 'OK' })
    const log = await db().select().from(entryLog)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ decision: 'ADMIT', path: 'qr', reason: 'OK', uid })
  })

  it('does not call onAdmit on a REJECT', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.revokeAt(uid, 5n)
    const calls: unknown[] = []
    const app = appWith({
      chain,
      now: () => NOW,
      onAdmit: (info) => {
        calls.push(info)
      },
    })
    await scan(app, configuredEnv(del), `fuda:v1:${uid}`)
    expect(calls).toHaveLength(0)
  })

  it('leaves the GET preview free of slot consumption and logging', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid: Hex = seedRight(chain, del, { usageModel: 0 })
    const res = await appWith({ chain, now: () => NOW }).request(`/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ decision: 'ADMIT', reason: 'OK' })
    await expect(db().select().from(slots)).resolves.toHaveLength(0)
    await expect(db().select().from(entryLog)).resolves.toHaveLength(0)
  })
})
