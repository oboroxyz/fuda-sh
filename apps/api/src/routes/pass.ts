import { normalizeUid } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Hex } from 'viem'

import { members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse } from '../json.ts'
import { passView } from '../pass/pass-view.ts'
import type { PassOutcome } from '../pass/pass-view.ts'
import { PassPage } from '../pass/PassPage.tsx'
import { resolveVerdict } from './verify.ts'

export const passRoutes = new Hono<AppEnv>()

// The browser-based pass: the all-OS floor (spec §9). Depends on no platform
// secrets and never 5xxs — a chain failure only degrades the status to UNKNOWN.
passRoutes.get('/pass/:uid', async (c) => {
  const uid = normalizeUid(c.req.param('uid'))
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  // The live status is read per request; a cached copy would show a stale
  // verdict at the door.
  c.header('cache-control', 'no-store')
  const row = await c.get('db').select().from(members).where(eq(members.attestationUid, uid)).get()
  if (row === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const resolved = await resolveVerdict(c, uid, c.get('now')())
  const outcome: PassOutcome = resolved.ok
    ? { decision: resolved.out.decision, reason: resolved.out.reason }
    : null
  // Annotated (not cast): holder is written only from validated Hex values.
  const holder: Hex | null = row.holder === null ? null : `0x${row.holder.slice(2)}`
  return await c.html(PassPage(passView({ holder, level: row.level, tier: row.tier, uid }, outcome)))
})

// Plan 5 replaces these two with @fuda/pass builders.
passRoutes.get('/pass/:uid/google', (c) =>
  normalizeUid(c.req.param('uid')) === null
    ? errorResponse(c, 'bad_uid', 400)
    : errorResponse(c, 'google_not_configured', 501),
)
passRoutes.get('/pass/:uid/apple.pkpass', (c) =>
  normalizeUid(c.req.param('uid')) === null
    ? errorResponse(c, 'bad_uid', 400)
    : errorResponse(c, 'apple_not_configured', 501),
)
