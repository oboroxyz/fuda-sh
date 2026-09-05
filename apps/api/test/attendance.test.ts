import { createExecutionContext, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { attendanceHook } from '../src/attendance/attendance-hook.ts'
import { getDb } from '../src/db/client.ts'
import { entryLog, slots } from '../src/db/schema.ts'
import { parseSchemaSets } from '../src/eas/schemas.ts'
import { appWith, fakeChain } from './env.ts'
import { ATT, configuredEnv, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

// Hono forwards a 4th `app.request` argument as the ExecutionContext, so the
// route's waitUntil is the real one here. The workers-types `ExecutionContext`
// carries members no object literal can supply (`exports`, `tracing`), so the
// context comes from the pool and only its `waitUntil` is intercepted: the test
// keeps the promise and awaits it itself instead of letting the runtime do so.
const executionCtx = (kept: Promise<unknown>[]): ExecutionContext => {
  const ctx = createExecutionContext()
  ctx.waitUntil = (p: Promise<unknown>) => {
    kept.push(p)
  }
  return ctx
}

const scanWith = async (
  chain: ReturnType<typeof fakeChain>,
  uid: string,
  bindings: ReturnType<typeof configuredEnv>,
  kept: Promise<unknown>[],
): Promise<Response> => {
  const app = appWith({
    chain,
    now: () => NOW,
    onAdmit: attendanceHook({ chain, db: db(), sets: parseSchemaSets(bindings.EAS_SCHEMAS) }),
  })
  return await app.request(
    '/verify',
    {
      body: JSON.stringify({ qr: `fuda:v1:${uid}` }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    bindings,
    executionCtx(kept),
  )
}

describe('Attendance on ADMIT', () => {
  // Storage is shared across the tests in this file, so both tables this file
  // writes start empty for every test.
  beforeEach(async () => {
    await db().delete(entryLog)
    await db().delete(slots)
  })

  it('attests Attendance after the verdict and backfills entry_log.attendance_uid', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const kept: Promise<unknown>[] = []
    const res = await scanWith(chain, uid, configuredEnv(del), kept)
    expect(res.status).toBe(200)
    expect(kept).toHaveLength(1)
    await Promise.all(kept)
    const att = [...chain.attestations.values()].find((a) => a.schema === ATT)
    expect(att?.refUID).toBe(uid)
    const row = await db().select().from(entryLog).get()
    expect(row?.attendanceUid).toBe(att?.uid)
  })

  it('does not attest on a REJECT', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { level: 1 })
    const kept: Promise<unknown>[] = []
    const res = await scanWith(chain, uid, configuredEnv(del), kept)
    expect(res.status).toBe(200)
    // Pins the verdict: without it a 502 chain_error would satisfy the two
    // assertions below without ever reaching the reject path.
    await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
    expect(kept).toHaveLength(0)
    expect([...chain.attestations.values()].some((a) => a.schema === ATT)).toBeFalsy()
  })
})
