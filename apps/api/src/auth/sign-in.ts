import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { consumeNonce, mintNonce } from '../verify/challenge.ts'

// What the operator's wallet signs (EIP-191 personal-sign). The nonce is the
// only variable part, so the wallet shows a stable, readable prompt.
export const signInMessage = (nonce: Hex): string => `fuda.sh dashboard sign-in\nnonce: ${nonce}`

// Sign-in nonces share the gate's `challenges` table, keyed under an
// `operator:` prefix so a gate nonce can never be spent as a sign-in and vice
// versa. Same TTL, same sweep-on-mint.
const subject = (address: Hex): string => `operator:${address.toLowerCase()}`

export const mintSignIn = async (
  db: Db,
  address: Hex,
  now: number,
): Promise<{ message: string; nonce: Hex }> => {
  const nonce = await mintNonce(db, subject(address), now)
  return { message: signInMessage(nonce), nonce }
}

export const consumeSignIn = async (db: Db, p: { address: Hex; nonce: Hex; now: number }): Promise<boolean> =>
  await consumeNonce(db, { nonce: p.nonce, now: p.now, subject: subject(p.address) })
