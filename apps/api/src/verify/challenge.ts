import { CHALLENGE_TTL_SECONDS, challengeMessage } from '@fuda/sdk'
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { challenges } from '../db/schema.ts'
import { toHex } from '../hex.ts'

// Annotated (not cast): a byte array renders as an even-length lowercase hex string.
const randomNonce = (): Hex => `0x${toHex(crypto.getRandomValues(new Uint8Array(16)))}`

// Minting also sweeps the table: past the TTL a nonce can never be consumed
// again, spent or not, so the row has no further use. Doing it here keeps the
// table bounded by the mint rate without a cron, and the sweep rides along in
// the same batch as the insert.
export const mintNonce = async (db: Db, subject: string, now: number): Promise<Hex> => {
  const nonce = randomNonce()
  await db.batch([
    db.delete(challenges).where(lt(challenges.createdAt, sql`${now} - ${CHALLENGE_TTL_SECONDS}`)),
    db.insert(challenges).values({ createdAt: now, nonce, uid: subject }),
  ])
  return nonce
}

// A single conditional UPDATE: one-time, bound to the subject, and inside the
// TTL. The write is the lock: consumed iff a row changed.
export const consumeNonce = async (
  db: Db,
  p: { nonce: Hex; now: number; subject: string },
): Promise<boolean> => {
  const res = await db
    .update(challenges)
    .set({ usedAt: p.now })
    .where(
      and(
        eq(challenges.nonce, p.nonce),
        eq(challenges.uid, p.subject),
        isNull(challenges.usedAt),
        gt(challenges.createdAt, sql`${p.now} - ${CHALLENGE_TTL_SECONDS}`),
      ),
    )
    .run()
  return res.meta.changes > 0
}

// docs/specs/pass-types-and-flows.md#gate-protocol: no chain lookup — a challenge for a nonexistent or revoked uid is minted
// anyway and /verify-signed step 1 rejects it later.
export const mintChallenge = async (
  db: Db,
  uid: Hex,
  now: number,
): Promise<{ challenge: string; nonce: Hex }> => {
  const nonce = await mintNonce(db, uid, now)
  return { challenge: challengeMessage(uid, nonce), nonce }
}

export const consumeChallenge = async (db: Db, p: { uid: Hex; nonce: Hex; now: number }): Promise<boolean> =>
  await consumeNonce(db, { nonce: p.nonce, now: p.now, subject: p.uid })
