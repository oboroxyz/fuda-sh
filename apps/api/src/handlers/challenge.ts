import { ChallengeBody, normalizeUid } from '@fuda/sdk'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { gatePasskeyOptions, relyingParty } from '../auth/passkey.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { mintChallenge } from '../verify/challenge.ts'
import { attestedPasskeyOf, loadOffchainRow } from '../verify/verify-offchain.ts'

// Open endpoint (docs/specs/pass-types-and-flows.md#gate-protocol): mints a one-time nonce for the Signed gate.
export const postV1Challenge = defineHandler(async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(ChallengeBody, body)
  const uid = parsed.success ? normalizeUid(parsed.output.uid) : null
  if (!parsed.success || uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  c.header('cache-control', 'no-store')
  const db = c.get('db')
  const minted = await mintChallenge(db, uid, c.get('now')(), parsed.output.venue)
  const row = await loadOffchainRow(db, uid)
  const key = row === null ? null : attestedPasskeyOf(row)
  return jsonResponse(
    c,
    key === null
      ? minted
      : { ...minted, webauthn: await gatePasskeyOptions(relyingParty(c.env), key, minted.challenge) },
  )
})
