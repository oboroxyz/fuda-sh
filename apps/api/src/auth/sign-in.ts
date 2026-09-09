import { CHALLENGE_TTL_SECONDS } from '@fuda/sdk'
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { challenges } from '../db/schema.ts'
import { randomNonce } from '../verify/challenge.ts'
import type { SessionAudience } from './session.ts'

// What the operator's wallet signs (EIP-191 personal-sign). The nonce is the
// only variable part, so the wallet shows a stable, readable prompt.
export const SIGN_IN_PREFIX = 'fuda.sh dashboard sign-in'
export const MEMBER_SIGN_IN_PREFIX = 'fuda.sh member sign-in'
export const signInMessage = (audience: SessionAudience, nonce: Hex): string =>
  `${audience === 'operator' ? SIGN_IN_PREFIX : MEMBER_SIGN_IN_PREFIX}\nnonce: ${nonce}`

// Sign-in nonces share the gate's `challenges` table, keyed under an
// `operator:` prefix so a gate nonce can never be spent as a sign-in and vice
// versa. Same TTL, same sweep-on-mint.
const subject = (audience: SessionAudience, address: Hex): string => `${audience}:${address.toLowerCase()}`

export const mintSignIn = async (
  db: Db,
  address: Hex,
  audience: SessionAudience,
  now: number,
): Promise<{ message: string; nonce: Hex }> => {
  const nonce = randomNonce()
  await db.batch([
    db.delete(challenges).where(lt(challenges.createdAt, sql`${now} - ${CHALLENGE_TTL_SECONDS}`)),
    db.insert(challenges).values({ createdAt: now, nonce, uid: subject(audience, address) }),
  ])
  return { message: signInMessage(audience, nonce), nonce }
}

export const consumeSignIn = async (
  db: Db,
  p: { address: Hex; audience: SessionAudience; nonce: Hex; now: number },
): Promise<boolean> => {
  const res = await db
    .update(challenges)
    .set({ usedAt: p.now })
    .where(
      and(
        eq(challenges.nonce, p.nonce),
        eq(challenges.uid, subject(p.audience, p.address)),
        isNull(challenges.usedAt),
        gt(challenges.createdAt, sql`${p.now} - ${CHALLENGE_TTL_SECONDS}`),
      ),
    )
    .run()
  return res.meta.changes > 0
}
