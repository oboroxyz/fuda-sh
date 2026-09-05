import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { entryLog, slots } from '../src/db/schema.ts'
import { admitSingleUse } from '../src/verify/admit.ts'
import { NOW } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const UID = `0x${'ab'.repeat(32)}` as const

describe('D1 batch transactionality', () => {
  beforeEach(async () => {
    await db().delete(slots)
    await db().delete(entryLog)
  })

  // The design of admitSingleUse rests on this: a batch is one transaction.
  it('rolls back the first statement when the second fails', async () => {
    const insertSlot = env.DB.prepare('INSERT INTO slots (uid, slot, consumed_at) VALUES (?1, ?2, ?3)').bind(
      UID,
      'default',
      NOW,
    )
    const broken = env.DB.prepare('INSERT INTO no_such_table (x) VALUES (1)')
    await expect(env.DB.batch([insertSlot, broken])).rejects.toThrow(/no such table/iu)
    await expect(db().select().from(slots)).resolves.toHaveLength(0)
  })
})

describe(admitSingleUse, () => {
  beforeEach(async () => {
    await db().delete(slots)
    await db().delete(entryLog)
  })

  it('admits once, writing the slot and the ADMIT row together', async () => {
    const first = await admitSingleUse(db(), UID, 'qr', NOW)
    expect(first.admitted).toBeTruthy()
    const log = await db().select().from(entryLog)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ decision: 'ADMIT', path: 'qr', reason: 'OK', uid: UID })
    await expect(db().select().from(slots)).resolves.toHaveLength(1)
  })

  it('returns the id of the ADMIT row it wrote', async () => {
    const first = await admitSingleUse(db(), UID, 'signature', NOW)
    const log = await db().select().from(entryLog)
    expect(first).toStrictEqual({ admitted: true, entryLogId: log[0]?.id })
  })

  it('does not admit twice and writes nothing on the second attempt', async () => {
    await admitSingleUse(db(), UID, 'qr', NOW)
    const second = await admitSingleUse(db(), UID, 'qr', NOW + 1)
    expect(second).toStrictEqual({ admitted: false })
    await expect(db().select().from(entryLog)).resolves.toHaveLength(1)
    await expect(db().select().from(slots)).resolves.toHaveLength(1)
  })
})
