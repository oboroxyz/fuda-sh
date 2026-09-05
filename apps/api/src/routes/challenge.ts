import { ChallengeBody, normalizeUid } from '@fuda/sdk'
import { Hono } from 'hono'
import * as v from 'valibot'

import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { mintChallenge } from '../verify/challenge.ts'

export const challengeRoutes = new Hono<AppEnv>()

// Open endpoint (spec §3): mints a one-time nonce for the Signed gate.
challengeRoutes.post('/challenge', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(ChallengeBody, body)
  const uid = parsed.success ? normalizeUid(parsed.output.uid) : null
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  c.header('cache-control', 'no-store')
  return jsonResponse(c, await mintChallenge(c.get('db'), uid, c.get('now')()))
})
