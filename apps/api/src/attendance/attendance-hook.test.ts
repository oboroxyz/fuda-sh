import { env } from 'cloudflare:test'
import { getAddress } from 'viem'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { fakeChain } from '../../test/env.ts'
import { ATT, DEL, ENT, HOLDER, NOW } from '../../test/fixtures.ts'
import { ZERO_UID } from '../chain/client.ts'
import { getDb } from '../db/client.ts'
import { entryLog } from '../db/schema.ts'
import { decodeAttendanceV1 } from '../eas/codecs.ts'
import type { SchemaSets } from '../eas/schemas.ts'
import type { AdmitInfo } from '../verify/admit.ts'
import { attendanceHook, recordAttendance } from './attendance-hook.ts'

const db = () => getDb({ DB: env.DB })
const RIGHT: Hex = `0x${'ab'.repeat(32)}`
const sets: SchemaSets = {
  attendance: [{ uid: ATT, version: 1 }],
  entitlement: [{ uid: ENT, version: 1 }],
  issuerDelegation: [{ uid: DEL, version: 1 }],
}

const seedEntry = async (): Promise<number> => {
  const row = await db()
    .insert(entryLog)
    .values({ at: NOW, decision: 'ADMIT', path: 'qr', reason: 'OK', uid: RIGHT })
    .returning({ id: entryLog.id })
    .get()
  return row.id
}

const infoFor = (entryLogId: number, waitUntil: AdmitInfo['waitUntil']): AdmitInfo => ({
  entryLogId,
  holder: HOLDER,
  now: NOW,
  uid: RIGHT,
  waitUntil,
})

describe(recordAttendance, () => {
  // Storage is shared across the tests in this file, so the one table it writes
  // starts empty for every test.
  beforeEach(async () => {
    await db().delete(entryLog)
  })

  it('attests Attendance with refUID = the right and writes the uid back', async () => {
    const chain = fakeChain()
    const id = await seedEntry()
    await recordAttendance(
      { chain, db: db(), sets },
      infoFor(id, () => {}),
    )
    const att = [...chain.attestations.values()].find((a) => a.schema === ATT)
    expect(att).toMatchObject({ recipient: getAddress(HOLDER), refUID: RIGHT, revocable: true })
    expect(decodeAttendanceV1(att?.data ?? '0x')).toStrictEqual({
      enteredAt: BigInt(NOW),
      holder: getAddress(HOLDER),
      rightUID: RIGHT,
      slotId: ZERO_UID,
    })
    const row = await db().select().from(entryLog).get()
    expect(row?.attendanceUid).toBe(att?.uid)
  })

  it('swallows a failed attest and leaves attendance_uid NULL', async () => {
    const chain = fakeChain()
    chain.failWrites = true
    const id = await seedEntry()
    await expect(
      recordAttendance(
        { chain, db: db(), sets },
        infoFor(id, () => {}),
      ),
    ).resolves.toBeUndefined()
    const row = await db().select().from(entryLog).get()
    expect(row?.attendanceUid).toBeNull()
  })

  it('swallows an attest that throws synchronously', async () => {
    const chain = fakeChain()
    chain.attest = () => {
      throw new Error('sync boom')
    }
    const id = await seedEntry()
    await expect(
      recordAttendance(
        { chain, db: db(), sets },
        infoFor(id, () => {}),
      ),
    ).resolves.toBeUndefined()
    const row = await db().select().from(entryLog).get()
    expect(row?.attendanceUid).toBeNull()
  })

  it('is a no-op without a signer or without an accepted Attendance version', async () => {
    const id = await seedEntry()
    const noSigner = fakeChain({ signer: null })
    await recordAttendance(
      { chain: noSigner, db: db(), sets },
      infoFor(id, () => {}),
    )
    const noSet = fakeChain()
    await recordAttendance(
      { chain: noSet, db: db(), sets: { ...sets, attendance: [] } },
      infoFor(id, () => {}),
    )
    expect(noSigner.attestations.size + noSet.attestations.size).toBe(0)
  })
})

describe(attendanceHook, () => {
  it('hands one promise to waitUntil and never throws', async () => {
    const chain = fakeChain()
    const id = await seedEntry()
    const kept: Promise<unknown>[] = []
    const hook = attendanceHook({ chain, db: db(), sets })
    expect(() => {
      hook(
        infoFor(id, (p) => {
          kept.push(p)
        }),
      )
    }).not.toThrow()
    expect(kept).toHaveLength(1)
    await Promise.all(kept)
    expect([...chain.attestations.values()].some((a) => a.schema === ATT)).toBe(true)
  })
})
