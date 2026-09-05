import { isUid } from '@fuda/sdk'
import { Hono } from 'hono'

import { ChainError } from '../chain/client.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { verifyConfig } from '../verify/config.ts'
import type { VerifyOutcome } from '../verify/verify-uid.ts'
import { verifyUid } from '../verify/verify-uid.ts'

export const verdictBody = (out: VerifyOutcome) => ({
  decision: out.decision,
  delegation: out.delegation,
  entitlement: out.entitlement,
  reason: out.reason,
})

export const verifyRoutes = new Hono<AppEnv>()

// Read-only preview: answers "is this right valid?", never "may it enter by QR?".
// Never consumes a slot, never logged, never rejects on level.
verifyRoutes.get('/verify/:uid', async (c) => {
  const uid = c.req.param('uid')
  if (!isUid(uid)) {
    return errorResponse(c, 'bad_uid', 400)
  }
  // A malformed EAS_SCHEMAS binding is a deployment defect, not attacker input:
  // fail closed with the same chain_error the caller already handles.
  let deps: ReturnType<typeof verifyConfig>
  try {
    deps = verifyConfig(c.env, c.get('chain'), c.get('now')())
  } catch {
    return errorResponse(c, 'chain_error', 502)
  }
  try {
    const out = await verifyUid(deps, uid)
    return jsonResponse(c, verdictBody(out))
  } catch (error) {
    if (error instanceof ChainError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw error
  }
})
