import type { BadgeView, VerifyResponse } from '@fuda/sdk'
import { normalizeUid, parseQr, VerifyBody } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'
import { defineHandler } from 'void'

import { readBadges } from '../badges/store.ts'
import { ChainError } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { issuers, members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { admitAndHook, logEntry } from '../verify/admit.ts'
import { offchainVerifyConfig, verifyConfig } from '../verify/config.ts'
import { qrOutcome } from '../verify/qr-admission.ts'
import { loadOffchainRow, verifyOffchain } from '../verify/verify-offchain.ts'
import type { VerifyOutcome } from '../verify/verify-uid.ts'
import { verifyUid } from '../verify/verify-uid.ts'

// Advisory: a badge is extra information about an existing decision, so a
// failed lookup omits the field rather than failing the scan.
export const badgesFor = async (c: Context<AppEnv>, uid: Hex): Promise<BadgeView[]> => {
  try {
    return await readBadges(c.get('db'), uid)
  } catch {
    return []
  }
}

// Both entry paths answer the same body. The parameter is the widened shape so a
// route can report a verdict it decided itself (LEVEL_REQUIRED, ALREADY_USED)
// over the entitlement and delegation the gate check already resolved. Badges
// are optional and advisory: an empty list means no `badges` key at all, so a
// Right without one keeps the exact response shape it had before badges existed.
export const verdictBody = (
  out: Pick<VerifyOutcome, 'decision' | 'reason' | 'entitlement' | 'delegation'> & { unconfirmed?: true },
  badges: BadgeView[] = [],
) => {
  const body: VerifyResponse = {
    decision: out.decision,
    delegation: out.delegation,
    entitlement: out.entitlement,
    reason: out.reason,
  }
  // Written only when true, so every other verdict keeps its exact shape. A route
  // that turned this ADMIT into its own REJECT has nothing left to qualify.
  if (out.decision === 'ADMIT' && out.unconfirmed === true) {
    body.unconfirmed = true
  }
  return badges.length === 0 ? body : { ...body, badges }
}

// A rejection from a best-effort side effect is not this request's business,
// but leaving it unobserved would surface as an unhandled rejection.
const swallow = async (p: Promise<unknown>): Promise<void> => {
  try {
    await p
  } catch {
    // best-effort by construction: nothing here can fail an admission
  }
}

// Hono's `c.executionCtx` getter throws when the app is invoked without one
// (`app.request(...)` in tests). The fallback starts the promise and swallows
// its rejection, so a test never sees an unhandled one.
export const waitUntilOf = (c: Context<AppEnv>): ((p: Promise<unknown>) => void) => {
  try {
    const ctx = c.executionCtx
    return ctx.waitUntil.bind(ctx)
  } catch {
    return (p) => {
      void swallow(p)
    }
  }
}

// Either the gate-check outcome, or the error response to return unchanged. Shared by
// both entry paths so a config or chain failure answers 502 chain_error
// identically, and so neither path can log a non-decision.
type Resolved = { ok: true; out: VerifyOutcome } | { ok: false; res: Response }

export const resolveVerdict = async (c: Context<AppEnv>, uid: Hex, now: number): Promise<Resolved> => {
  // An offchain right is decided from its D1 row, and needs none of the on-chain
  // configuration below (docs/specs/attestation-model.md#offchain-rights).
  const offchain = await loadOffchainRow(c.get('db'), uid)
  if (offchain !== null) {
    const chain = c.get('chain')
    let deps: ReturnType<typeof offchainVerifyConfig>
    try {
      deps = offchainVerifyConfig(c.env, chain, now)
    } catch {
      return { ok: false, res: errorResponse(c, 'chain_error', 502) }
    }
    try {
      const out = await verifyOffchain(deps, uid, offchain)
      return { ok: true, out }
    } catch (error) {
      if (error instanceof ChainError) {
        return { ok: false, res: errorResponse(c, 'chain_error', 502) }
      }
      throw error
    }
  }
  // A malformed EAS_SCHEMAS binding is a deployment defect, not attacker input:
  // fail closed with the same chain_error the caller already handles.
  let deps: ReturnType<typeof verifyConfig>
  try {
    deps = verifyConfig(c.env, c.get('chain'), now)
  } catch {
    return { ok: false, res: errorResponse(c, 'chain_error', 502) }
  }
  try {
    return { ok: true, out: await verifyUid(deps, uid) }
  } catch (error) {
    if (error instanceof ChainError) {
      return { ok: false, res: errorResponse(c, 'chain_error', 502) }
    }
    throw error
  }
}

// Read-only preview: answers "is this right valid?", never "may it enter by QR?".
// Never consumes a slot, never logged, never rejects on level.
export const getV1VerifyUid = defineHandler(async (c) => {
  const uid = normalizeUid(c.req.param().uid)
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  // A preview is a live read: never let an intermediary answer it from cache.
  c.header('cache-control', 'no-store')
  const resolved = await resolveVerdict(c, uid, c.get('now')())
  if (!resolved.ok) {
    return resolved.res
  }
  const badges = await badgesFor(c, uid)
  return jsonResponse(c, verdictBody(resolved.out, badges))
})

// The Handle of the venue that issued the uid, whichever way the right is
// recorded. null when no member row or no issuer stands behind it.
export const venueOf = async (db: Db, uid: Hex): Promise<string | null> => {
  const row = await db
    .select({ handle: issuers.handle })
    .from(members)
    .innerJoin(issuers, eq(issuers.id, members.issuerId))
    .where(eq(members.attestationUid, uid))
    .get()
  return row?.handle ?? null
}

// Admission by QR. Order: the gate's venue (when it names one) → chain verification (docs/specs/attestation-model.md#gate-verification-order-and-reasons) → level 0 only → SINGLE_USE slot
// → entry log → onAdmit. The level check precedes slot consumption so a
// photographed Signed pass cannot burn its holder's slot. Every decision-shaped
// verdict is logged with path 'qr'; 4xx input errors and 502 chain errors are not.
export const postV1Verify = defineHandler(async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(VerifyBody, body)
  const uid = parsed.success ? parseQr(parsed.output.qr) : null
  if (uid === null) {
    return errorResponse(c, 'bad_qr', 400)
  }
  // One clock reading decides the validity window and stamps the log row.
  const now = c.get('now')()
  // A gate that names its venue turns away another venue's pass before anything
  // else is read, so it burns no slot and reports nothing about the pass. A uid
  // with no issuer behind it cannot be shown to belong to that venue either.
  const venue = parsed.success ? parsed.output.venue : undefined
  if (venue !== undefined && (await venueOf(c.get('db'), uid)) !== venue) {
    await logEntry(c.get('db'), { at: now, decision: 'REJECT', path: 'qr', reason: 'WRONG_VENUE', uid })
    return jsonResponse(c, verdictBody({ decision: 'REJECT', reason: 'WRONG_VENUE' }))
  }
  const resolved = await resolveVerdict(c, uid, now)
  if (!resolved.ok) {
    return resolved.res
  }
  const out = qrOutcome(resolved.out)
  const db = c.get('db')
  const badges = await badgesFor(c, uid)
  const reject = async (reason: 'LEVEL_REQUIRED' | 'ALREADY_USED'): Promise<Response> => {
    await logEntry(db, { at: now, decision: 'REJECT', path: 'qr', reason, uid })
    return jsonResponse(c, verdictBody({ ...out, decision: 'REJECT', reason }, badges))
  }
  if (out.decision === 'REJECT') {
    await logEntry(db, { at: now, decision: 'REJECT', path: 'qr', reason: out.reason, uid })
    return jsonResponse(c, verdictBody(out, badges))
  }
  const outcome = await admitAndHook({
    canonical: out.canonical,
    db,
    now,
    onAdmit: c.get('onAdmit'),
    path: 'qr',
    uid,
    waitUntil: waitUntilOf(c),
  })
  if (!outcome.admitted) {
    return await reject(outcome.reason)
  }
  return jsonResponse(c, verdictBody(out, badges))
})
