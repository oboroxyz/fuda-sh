import {
  LEVEL_CODE,
  challengeMessage,
  isUid,
  normalizeNonce,
  normalizeUid,
  VerifySignedBody,
} from '@fuda/sdk'
import type { VerifySignedRequest, VerifySignedResponse } from '@fuda/sdk'
import type { Context } from 'hono'
import * as v from 'valibot'
import { isAddressEqual, recoverMessageAddress } from 'viem'
import type { Hex } from 'viem'
import { defineHandler } from 'void'

import { relyingParty, verifyGateAssertion } from '../auth/passkey.ts'
import { ChainError } from '../chain/client.ts'
import type { AttestedPasskey } from '../eas/offchain.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { admitAndHook, logEntry } from '../verify/admit.ts'
import { consumeChallenge } from '../verify/challenge.ts'
import type { VerifyOutcome } from '../verify/verify-uid.ts'
import { resolveVerdict, venueHandleOf, waitUntilOf } from './verify.ts'

// Which of the two 4xx codes a malformed body earns: a uid that is absent or not
// a uid at all is `bad_uid`; a well-formed uid with anything else wrong (nonce,
// signature) is `bad_input`.
const UidOnly = v.object({ uid: v.string() })

// A Sensitive pass's key is a plain secp256k1 key, so this needs no chain read.
const signedBy = async (address: Hex, message: string, signature: Hex): Promise<boolean> => {
  try {
    return isAddressEqual(await recoverMessageAddress({ message, signature }), address)
  } catch {
    return false
  }
}

// Challenge-response admission (docs/specs/pass-types-and-flows.md#gate-protocol). An
// Identified pass answers with its attested passkey, a Sensitive pass with its attested key,
// and any other right with its holder's signature; any proof on another kind of right is a wrong signature. Order is the contract: chain
// verification → consume the challenge → verify the signature → SINGLE_USE slot →
// log → onAdmit. Consuming the challenge before checking the signature is the
// replay protection: a wrong signature burns its nonce. Every verdict is 200 in
// one shape and logged with path 'signature'; 4xx input errors and 502 chain
// errors are not logged. A chain failure during the signature check answers 502
// after the challenge was consumed — the member simply fetches a new one (they
// are 300 s, free, and cost nothing to mint).
const proofHolds = async (
  c: Context<AppEnv>,
  proof: VerifySignedRequest,
  right: { holder: Hex; holderAddress: Hex | null; message: string; passkey: AttestedPasskey | null },
): Promise<boolean> => {
  const { holder, holderAddress, message, passkey } = right
  if ('webauthn' in proof) {
    return (
      passkey !== null && (await verifyGateAssertion(relyingParty(c.env), passkey, message, proof.webauthn))
    )
  }
  if (passkey !== null) {
    return false
  }
  // Annotated (not cast): SIGNATURE_RE guarantees the 0x prefix, so the template
  // literal narrows to Hex. Case is preserved — a signature is opaque bytes.
  const signature: Hex = `0x${proof.signature.slice(2)}`
  if (holderAddress !== null) {
    return await signedBy(holderAddress, message, signature)
  }
  return await c.get('chain').verifyMessage({ address: holder, message, signature })
}

const admitSigned = async (
  c: Context<AppEnv>,
  uid: Hex,
  now: number,
  out: Extract<VerifyOutcome, { decision: 'ADMIT' }>,
  answer: (verdict: VerifySignedResponse) => Promise<Response>,
  withVenue: (verdict: VerifySignedResponse) => Response,
): Promise<Response> => {
  const db = c.get('db')
  const { holder } = out.canonical
  const outcome = await admitAndHook({
    canonical: out.canonical,
    db,
    now,
    onAdmit: c.get('onAdmit'),
    path: 'signature',
    uid,
    waitUntil: waitUntilOf(c),
  })
  if (!outcome.admitted) {
    return await answer({ decision: 'REJECT', holder, path: 'signature', reason: outcome.reason })
  }
  const admitted: VerifySignedResponse = {
    decision: 'ADMIT',
    holder,
    path: 'signature',
    reason: 'OK',
  }
  if (out.requirements !== undefined) admitted.requirements = out.requirements
  return withVenue(admitted)
}

export const postV1VerifySigned = defineHandler(async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(VerifySignedBody, body)
  if (!parsed.success) {
    const onlyUid = v.safeParse(UidOnly, body)
    const uidOk = onlyUid.success && isUid(onlyUid.output.uid)
    return errorResponse(c, uidOk ? 'bad_input' : 'bad_uid', 400)
  }
  const uid = normalizeUid(parsed.output.uid)
  const nonce = normalizeNonce(parsed.output.nonce)
  if (uid === null || nonce === null) {
    return errorResponse(c, uid === null ? 'bad_uid' : 'bad_input', 400)
  }
  // One clock reading decides the TTL window and stamps every row this request writes.
  const now = c.get('now')()
  const db = c.get('db')
  const { venue } = parsed.output
  const actualVenue = await venueHandleOf(db, uid)
  // Only a holder's proof earns the venue's name: knowing a uid must not reveal
  // which shop a Sensitive pass belongs to.
  let proven = false
  const withVenue = (verdict: VerifySignedResponse): Response => {
    if (proven && actualVenue !== null) {
      verdict.venue = actualVenue
    }
    return jsonResponse(c, verdict)
  }
  c.header('cache-control', 'no-store')

  const answer = async (verdict: VerifySignedResponse): Promise<Response> => {
    await logEntry(db, {
      at: now,
      decision: verdict.decision,
      path: 'signature',
      reason: verdict.reason,
      uid,
    })
    return withVenue(verdict)
  }

  if (venue !== undefined && actualVenue !== venue) {
    return await answer({
      decision: 'REJECT',
      path: 'signature',
      reason: 'WRONG_VENUE',
      stage: 'entitlement',
    })
  }
  const resolved = await resolveVerdict(c, uid, now)
  if (!resolved.ok) {
    return resolved.res
  }
  const { out } = resolved
  if (out.decision === 'REJECT') {
    // docs/specs/pass-types-and-flows.md#gate-protocol: `holder` is present once the attestation was decoded. Every decoded
    // rejection carries the entitlement view; NOT_FOUND and WRONG_SCHEMA do not,
    // and answer without a holder.
    const verdict: VerifySignedResponse = {
      decision: 'REJECT',
      path: 'signature',
      reason: out.reason,
      stage: 'entitlement',
      ...(out.requirement === undefined ? {} : { requirement: out.requirement }),
    }
    if (out.entitlement !== undefined) {
      verdict.holder = out.entitlement.holder
    }
    return await answer(verdict)
  }
  const { holder } = out.canonical
  // A right on chain at a level fuda no longer issues (level 2, once +Private) is
  // read like any other and then refused, before its challenge is spent.
  if (out.canonical.level > LEVEL_CODE.signed) {
    return await answer({
      decision: 'REJECT',
      holder,
      path: 'signature',
      reason: 'LEVEL_REQUIRED',
      stage: 'entitlement',
    })
  }
  if (!(await consumeChallenge(db, { nonce, now, uid, venue }))) {
    return await answer({
      decision: 'REJECT',
      holder,
      path: 'signature',
      reason: 'BAD_CHALLENGE',
      stage: 'challenge',
    })
  }
  let valid: boolean
  try {
    valid = await proofHolds(c, parsed.output, {
      holder,
      holderAddress: out.holderAddress ?? null,
      message: challengeMessage(uid, nonce, venue),
      passkey: out.passkey ?? null,
    })
  } catch (error) {
    if (error instanceof ChainError) {
      // The challenge is already consumed and stays consumed: this is not a
      // decision, so it is not logged, and the member mints a fresh nonce.
      return errorResponse(c, 'chain_error', 502)
    }
    throw error
  }
  if (!valid) {
    return await answer({ decision: 'REJECT', holder, path: 'signature', reason: 'BAD_SIGNATURE' })
  }
  proven = true
  return await admitSigned(c, uid, now, out, answer, withVenue)
})
