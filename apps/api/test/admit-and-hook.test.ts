import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { entryLog, slots } from '../src/db/schema.ts'
import { admitAndHook } from '../src/verify/admit.ts'
import type { AdmitInfo } from '../src/verify/admit.ts'
import { HOLDER, NOW } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const UID: Hex = `0x${'a1'.repeat(32)}`
const keep = (p: Promise<unknown>): void => {
  void p
}

describe(admitAndHook, () => {
  beforeEach(async () => {
    await db().delete(slots)
    await db().delete(entryLog)
  })

  it('logs a MULTI_USE admission without touching slots and calls the hook once', async () => {
    const calls: AdmitInfo[] = []
    const out = await admitAndHook({
      canonical: { holder: HOLDER, level: 1, usageModel: 1 },
      db: db(),
      now: NOW,
      onAdmit: (info) => {
        calls.push(info)
      },
      path: 'qr',
      uid: UID,
      waitUntil: keep,
    })
    expect(out.admitted).toBe(true)
    await expect(db().select().from(slots)).resolves.toHaveLength(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ holder: HOLDER, now: NOW, uid: UID })
  })

  it('burns the slot of a SINGLE_USE right and rejects the second admission', async () => {
    const ctx = {
      canonical: { holder: HOLDER, level: 0, usageModel: 0 as const },
      db: db(),
      now: NOW,
      onAdmit: () => {
        // hook not under test here
      },
      path: 'signature' as const,
      uid: UID,
      waitUntil: keep,
    }
    const first = await admitAndHook(ctx)
    const second = await admitAndHook(ctx)
    expect(first.admitted).toBe(true)
    expect(second).toStrictEqual({ admitted: false, reason: 'ALREADY_USED' })
    await expect(db().select().from(slots)).resolves.toHaveLength(1)
  })

  it('keeps the admission when the hook throws synchronously', async () => {
    const out = await admitAndHook({
      canonical: { holder: HOLDER, level: 0, usageModel: 1 },
      db: db(),
      now: NOW,
      onAdmit: () => {
        throw new Error('hook exploded')
      },
      path: 'qr',
      uid: UID,
      waitUntil: keep,
    })
    expect(out.admitted).toBe(true)
    const rows = await db().select().from(entryLog)
    expect(rows.map((r) => [r.decision, r.reason])).toStrictEqual([['ADMIT', 'OK']])
  })

  // Spec: a +Private right is never attested — a public Attendance would publish
  // the visit history +Private exists to hide. Its entries stay in the log only.
  it('logs a +Private admission but never calls the hook', async () => {
    const calls: AdmitInfo[] = []
    const out = await admitAndHook({
      canonical: { holder: HOLDER, level: 2, usageModel: 1 },
      db: db(),
      now: NOW,
      onAdmit: (info) => {
        calls.push(info)
      },
      path: 'signature',
      uid: UID,
      waitUntil: keep,
    })
    expect(out.admitted).toBe(true)
    expect(calls).toHaveLength(0)
    const rows = await db().select().from(entryLog)
    expect(rows).toMatchObject([{ attendanceUid: null, decision: 'ADMIT', path: 'signature', uid: UID }])
  })
})
