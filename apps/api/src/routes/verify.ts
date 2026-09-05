import { isUid, parseQr, USAGE_MODEL, VerifyBody } from '@fuda/sdk'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'

import { ChainError } from '../chain/client.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { consumeSlot, logEntry } from '../verify/admit.ts'
import { verifyConfig } from '../verify/config.ts'
import type { VerifyOutcome } from '../verify/verify-uid.ts'
import { verifyUid } from '../verify/verify-uid.ts'

// Both entry paths answer the same body. The parameter is the widened shape so a
// route can report a verdict it decided itself (LEVEL_REQUIRED, ALREADY_USED)
// over the entitlement and delegation §6 already resolved.
export const verdictBody = (
  out: Pick<VerifyOutcome, 'decision' | 'reason' | 'entitlement' | 'delegation'>,
) => ({
  decision: out.decision,
  delegation: out.delegation,
  entitlement: out.entitlement,
  reason: out.reason,
})

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
const waitUntilOf = (c: Context<AppEnv>): ((p: Promise<unknown>) => void) => {
  try {
    const ctx = c.executionCtx
    return ctx.waitUntil.bind(ctx)
  } catch {
    return (p) => {
      void swallow(p)
    }
  }
}

export const verifyRoutes = new Hono<AppEnv>()

// Either the §6 outcome, or the error response to return unchanged. Shared by
// both entry paths so a config or chain failure answers 502 chain_error
// identically, and so neither path can log a non-decision.
type Resolved = { ok: true; out: VerifyOutcome } | { ok: false; res: Response }

export const resolveVerdict = async (c: Context<AppEnv>, uid: Hex, now: number): Promise<Resolved> => {
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
verifyRoutes.get('/verify/:uid', async (c) => {
  const uid = c.req.param('uid')
  if (!isUid(uid)) {
    return errorResponse(c, 'bad_uid', 400)
  }
  const resolved = await resolveVerdict(c, uid, c.get('now')())
  return resolved.ok ? jsonResponse(c, verdictBody(resolved.out)) : resolved.res
})

// Admission by QR. Order: §6 chain verification → level 0 only → SINGLE_USE slot
// → entry log → onAdmit. The level check precedes slot consumption so a
// photographed Signed pass cannot burn its holder's slot. Every decision-shaped
// verdict is logged with path 'qr'; 4xx input errors and 502 chain errors are not.
verifyRoutes.post('/verify', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(VerifyBody, body)
  const uid = parsed.success ? parseQr(parsed.output.qr) : null
  if (uid === null) {
    return errorResponse(c, 'bad_qr', 400)
  }
  // One clock reading decides the validity window and stamps the log row.
  const now = c.get('now')()
  const resolved = await resolveVerdict(c, uid, now)
  if (!resolved.ok) {
    return resolved.res
  }
  const { out } = resolved
  const db = c.get('db')
  const reject = async (reason: 'LEVEL_REQUIRED' | 'ALREADY_USED'): Promise<Response> => {
    await logEntry(db, { at: now, decision: 'REJECT', path: 'qr', reason, uid })
    return jsonResponse(c, verdictBody({ ...out, decision: 'REJECT', reason }))
  }
  if (out.decision === 'REJECT') {
    await logEntry(db, { at: now, decision: 'REJECT', path: 'qr', reason: out.reason, uid })
    return jsonResponse(c, verdictBody(out))
  }
  if (out.canonical.level !== 0) {
    return await reject('LEVEL_REQUIRED')
  }
  if (out.canonical.usageModel === USAGE_MODEL.SINGLE_USE && !(await consumeSlot(db, uid, now))) {
    return await reject('ALREADY_USED')
  }
  const entryLogId = await logEntry(db, { at: now, decision: 'ADMIT', path: 'qr', reason: 'OK', uid })
  try {
    c.get('onAdmit')({
      entryLogId,
      holder: out.canonical.holder,
      now,
      uid,
      waitUntil: waitUntilOf(c),
    })
  } catch {
    // Attendance is best-effort (spec §8): a failed side effect never fails an admission
  }
  return jsonResponse(c, verdictBody(out))
})
