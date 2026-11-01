import { ChallengeBody, normalizeUid } from '@fuda/sdk'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { errorResponse, jsonResponse } from '../json.ts'
import { mintChallenge } from '../verify/challenge.ts'

// Open endpoint (docs/specs/pass-types-and-flows.md#gate-protocol): mints a one-time nonce for the Signed gate.
export const postV1Challenge = defineHandler(async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(ChallengeBody, body)
  const uid = parsed.success ? normalizeUid(parsed.output.uid) : null
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  c.header('cache-control', 'no-store')
  return jsonResponse(c, await mintChallenge(c.get('db'), uid, c.get('now')()))
})
