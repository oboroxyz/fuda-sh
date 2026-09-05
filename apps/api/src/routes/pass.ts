import { isUid } from '@fuda/sdk'
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
  const uid = c.req.param('uid')
  if (!isUid(uid)) {
    return errorResponse(c, 'bad_uid', 400)
  }
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
  isUid(c.req.param('uid'))
    ? errorResponse(c, 'google_not_configured', 501)
    : errorResponse(c, 'bad_uid', 400),
)
passRoutes.get('/pass/:uid/apple.pkpass', (c) =>
  isUid(c.req.param('uid'))
    ? errorResponse(c, 'apple_not_configured', 501)
    : errorResponse(c, 'bad_uid', 400),
)
