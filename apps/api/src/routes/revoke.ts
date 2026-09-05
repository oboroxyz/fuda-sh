import { RevokeBody } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'

import { ChainError, NoSignerError } from '../chain/client.ts'
import { members } from '../db/schema.ts'
import { newest, parseSchemaSets } from '../eas/schemas.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

export const revokeRoutes = new Hono<AppEnv>()

// On-chain revoke, then mark the row. An unknown or already-revoked uid reverts
// on EAS → 502 chain_error and the row is left untouched (no idempotence in the MVP).
revokeRoutes.post('/revoke', adminAuth(), async (c) => {
  const parsed = v.safeParse(RevokeBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_uid', 400)
  }
  // Annotated (not cast): RevokeBody validated uid as 0x + 64 hex, so the
  // contextually typed template literal narrows to Hex directly.
  const uid: Hex = `0x${parsed.output.uid.slice(2)}`
  const chain = c.get('chain')
  if (chain.signerAddress() === null) {
    return errorResponse(c, 'no_signer', 501)
  }
  const schema = newest(parseSchemaSets(c.env.EAS_SCHEMAS).entitlement)
  if (schema === null) {
    return errorResponse(c, 'chain_error', 502)
  }
  try {
    await chain.revoke(schema.uid, uid)
  } catch (error) {
    if (error instanceof NoSignerError) {
      return errorResponse(c, 'no_signer', 501)
    }
    if (error instanceof ChainError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw error
  }
  await c.get('db').update(members).set({ status: 'revoked' }).where(eq(members.attestationUid, uid))
  return jsonResponse(c, { revoked: true, uid })
})
