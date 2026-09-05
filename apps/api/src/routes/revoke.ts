import { RevokeBody } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'

import { ChainError, NoSignerError, ZERO_UID } from '../chain/client.ts'
import { members } from '../db/schema.ts'
import { findVersion, parseSchemaSets } from '../eas/schemas.ts'
import type { AcceptedVersion } from '../eas/schemas.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

// null means "this deployment's EAS_SCHEMAS binding is malformed" — a
// deployment defect, not caller input, so it fails closed with the same
// chain_error /issue and /verify answer.
const acceptedEntitlements = (json: string): AcceptedVersion[] | null => {
  try {
    return parseSchemaSets(json).entitlement
  } catch {
    return null
  }
}

export const revokeRoutes = new Hono<AppEnv>()

// On-chain revoke, then mark the row. The schema passed to EAS.revoke is the
// attestation's own — EAS reverts with InvalidSchema on any other, so revoking
// against the newest accepted version would make every older right unrevocable
// the moment a v2 Entitlement schema is accepted. An unknown uid, a uid that is
// not an accepted Entitlement, a malformed EAS_SCHEMAS binding and an
// already-revoked uid all answer 502 chain_error with the row left untouched
// (no idempotence in the MVP).
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
  try {
    const raw = await chain.readAttestation(uid)
    // A missing uid reads back as the zero struct; a non-Entitlement uid (a
    // delegation, say) is not this endpoint's to revoke.
    if (raw.uid === ZERO_UID) {
      return errorResponse(c, 'chain_error', 502)
    }
    const accepted = acceptedEntitlements(c.env.EAS_SCHEMAS)
    if (accepted === null || findVersion(accepted, raw.schema) === null) {
      return errorResponse(c, 'chain_error', 502)
    }
    await chain.revoke(raw.schema, uid)
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
