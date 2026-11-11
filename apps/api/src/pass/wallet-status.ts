import type { PassValidity } from '@fuda/pass'
import { rightStatus } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import type { members } from '../db/schema.ts'
import { offchainAttestations, slots } from '../db/schema.ts'
import { fromSignedJson } from '../eas/offchain.ts'

export const walletValidity = async (
  db: Db,
  uid: Hex,
  row: typeof members.$inferSelect,
  now: number,
): Promise<PassValidity> => {
  const [slot, offchain] = await Promise.all([
    db
      .select()
      .from(slots)
      .where(and(eq(slots.uid, uid), eq(slots.slot, 'default')))
      .get(),
    db.select().from(offchainAttestations).where(eq(offchainAttestations.uid, uid)).get(),
  ])
  const expirationTime =
    offchain === undefined ? 0n : (fromSignedJson(offchain.signed)?.message.expirationTime ?? 0n)
  const { status } = rightStatus({ ...row, consumed: slot !== undefined, expirationTime }, now)
  const expiry = Number(expirationTime)
  let { validUntil } = row
  if (expiry !== 0) {
    validUntil = validUntil === null || validUntil === 0 ? expiry : Math.min(expiry, validUntil)
  }
  return { status, validFrom: row.validFrom, validUntil }
}
