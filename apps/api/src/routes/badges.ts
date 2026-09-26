import { normalizeUid } from '@fuda/sdk'
import { Hono } from 'hono'
import * as v from 'valibot'

import { saveBadge } from '../badges/store.ts'
import { verifierFor } from '../badges/verifier.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { scheduleBadgePassUpdate } from '../pass/badge-update.ts'
import { resolveVerdict } from './verify.ts'

// The route names the claim, not the vendor: replacing the verifier behind a
// kind is not a client-visible change. No `@worldcoin/*` import belongs here —
// the vendor stays behind the `BadgeVerifier` seam.
export const badgeRoutes = new Hono<AppEnv>()

const BADGE_BUDGET = 30

// `payload` is an opaque, vendor-shaped proof — the verifier decodes it, the
// route never inspects it beyond forwarding it whole.
const BadgeBody = v.looseObject({ payload: v.unknown(), uid: v.string() })

badgeRoutes.post('/badges/:kind/context', rateLimit({ budget: BADGE_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const verifier = verifierFor(c.req.param('kind'))
  if (verifier === null) {
    return errorResponse(c, 'not_found', 404)
  }
  if (!verifier.configured(c.env)) {
    return errorResponse(c, 'badges_not_configured', 501)
  }
  return jsonResponse(c, await verifier.context(c.env))
})

badgeRoutes.post('/badges/:kind', rateLimit({ budget: BADGE_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const verifier = verifierFor(c.req.param('kind'))
  if (verifier === null) {
    return errorResponse(c, 'not_found', 404)
  }
  if (!verifier.configured(c.env)) {
    return errorResponse(c, 'badges_not_configured', 501)
  }
  const parsed = v.safeParse(BadgeBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_uid', 400)
  }
  const uid = normalizeUid(parsed.output.uid)
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  // A badge on a revoked or unknown Right would be a record nobody can use.
  const resolved = await resolveVerdict(c, uid, c.get('now')())
  if (!resolved.ok) {
    return resolved.res
  }
  if (resolved.out.decision !== 'ADMIT') {
    return errorResponse(c, 'not_found', 404)
  }
  const subject = await verifier.verify(c.env, { payload: parsed.output.payload, uid })
  if ('error' in subject) {
    return errorResponse(c, subject.error, 400)
  }
  const saved = await saveBadge(c.get('db'), {
    credential: subject.credential,
    expiresAt: subject.expiresAt,
    kind: verifier.kind,
    scope: subject.scope,
    subjectKey: subject.subjectKey,
    uid,
    verifiedAt: c.get('now')(),
    verifier: verifier.name,
  })
  if (!saved.ok) {
    return errorResponse(c, saved.conflict === 'subject' ? 'already_badged' : 'pass_already_badged', 409)
  }
  // Best-effort only, after the badge is durably saved: never on a 409 or any
  // earlier error path, and it cannot change this response either way.
  scheduleBadgePassUpdate(c, uid)
  return jsonResponse(c, { badge: saved.badge })
})
