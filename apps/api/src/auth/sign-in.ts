import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { consumeNonce, mintNonce } from '../verify/challenge.ts'
import type { SessionAudience } from './session.ts'

// What the operator's wallet signs (EIP-191 personal-sign). The nonce is the
// only variable part, so the wallet shows a stable, readable prompt.
const SIGN_IN_PREFIX = 'fuda.sh dashboard sign-in'
const MEMBER_SIGN_IN_PREFIX = 'fuda.sh member sign-in'
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
  const nonce = await mintNonce(db, subject(audience, address), now)
  return { message: signInMessage(audience, nonce), nonce }
}

export const consumeSignIn = async (
  db: Db,
  p: { address: Hex; audience: SessionAudience; nonce: Hex; now: number },
): Promise<boolean> =>
  await consumeNonce(db, { nonce: p.nonce, now: p.now, subject: subject(p.audience, p.address) })
