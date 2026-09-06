import { challengeMessage, isUid, normalizeNonce, normalizeUid, VerifySignedBody } from '@fuda/sdk'
import type { VerifySignedResponse } from '@fuda/sdk'
import { Hono } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'

import { ChainError } from '../chain/client.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { admitAndHook, logEntry } from '../verify/admit.ts'
import { consumeChallenge } from '../verify/challenge.ts'
import { resolveVerdict, waitUntilOf } from './verify.ts'

export const verifySignedRoutes = new Hono<AppEnv>()

// Which of the two 4xx codes a malformed body earns: a uid that is absent or not
// a uid at all is `bad_uid`; a well-formed uid with anything else wrong (nonce,
// signature) is `bad_input`.
const UidOnly = v.object({ uid: v.string() })

// Challenge-response admission (docs/specs/pass-types-and-flows.md#gate-protocol). Order is the contract: chain
// verification → consume the challenge → verify the signature → SINGLE_USE slot →
// log → onAdmit. Consuming the challenge before checking the signature is the
// replay protection: a wrong signature burns its nonce. Every verdict is 200 in
// one shape and logged with path 'signature'; 4xx input errors and 502 chain
// errors are not logged. A chain failure during the signature check answers 502
// after the challenge was consumed — the member simply fetches a new one (they
// are 300 s, free, and cost nothing to mint).
verifySignedRoutes.post('/verify-signed', async (c) => {
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
  // Annotated (not cast): SIGNATURE_RE guarantees the 0x prefix, so the template
  // literal narrows to Hex. Case is preserved — a signature is opaque bytes.
  const signature: Hex = `0x${parsed.output.signature.slice(2)}`
  // One clock reading decides the TTL window and stamps every row this request writes.
  const now = c.get('now')()
  const db = c.get('db')
  c.header('cache-control', 'no-store')

  const answer = async (verdict: VerifySignedResponse): Promise<Response> => {
    await logEntry(db, {
      at: now,
      decision: verdict.decision,
      path: 'signature',
      reason: verdict.reason,
      uid,
    })
    return jsonResponse(c, verdict)
  }

  const resolved = await resolveVerdict(c, uid, now)
  if (!resolved.ok) {
    return resolved.res
  }
  const { out } = resolved
  if (out.decision === 'REJECT') {
    // §3: `holder` is present once the attestation was decoded. Every decoded
    // rejection carries the entitlement view; NOT_FOUND and WRONG_SCHEMA do not,
    // and answer without a holder.
    const verdict: VerifySignedResponse = {
      decision: 'REJECT',
      path: 'signature',
      reason: out.reason,
      stage: 'entitlement',
    }
    if (out.entitlement !== undefined) {
      verdict.holder = out.entitlement.holder
    }
    return await answer(verdict)
  }
  const { holder } = out.canonical
  if (!(await consumeChallenge(db, { nonce, now, uid }))) {
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
    valid = await c
      .get('chain')
      .verifyMessage({ address: holder, message: challengeMessage(uid, nonce), signature })
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
  return jsonResponse(c, {
    decision: 'ADMIT',
    holder,
    path: 'signature',
    reason: 'OK',
  } satisfies VerifySignedResponse)
})
