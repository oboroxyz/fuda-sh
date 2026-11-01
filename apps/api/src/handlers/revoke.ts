import { normalizeUid, RevokeBody } from '@fuda/sdk'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { errorResponse, jsonResponse } from '../json.ts'
import { operatorOrAdmin } from '../middleware/operator-or-admin.ts'
import { revokePass } from '../passes/revoke-pass.ts'
import type { RevokeError } from '../passes/revoke-pass.ts'

const STATUS = { chain_error: 502, no_signer: 501, not_found: 404 } as const satisfies Record<
  RevokeError,
  number
>

export const postV1Revoke = defineHandler(operatorOrAdmin(), async (c) => {
  const parsed = v.safeParse(RevokeBody, await c.req.json().catch(() => null))
  // Normalized at entry: the chain read and the row update must agree on one
  // spelling of the uid, and D1 holds it lower case.
  const uid = parsed.success ? normalizeUid(parsed.output.uid) : null
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  const outcome = await revokePass(c, uid, c.get('actingIssuer'))
  return outcome.ok
    ? jsonResponse(c, { revoked: true, uid })
    : errorResponse(c, outcome.error, STATUS[outcome.error])
})
