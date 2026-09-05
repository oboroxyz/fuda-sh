import { deriveIssueKind, IssueBody } from '@fuda/sdk'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'

import { ChainError, NoSignerError, ZERO_ADDRESS, ZERO_UID } from '../chain/client.ts'
import { parseSchemaSets } from '../eas/schemas.ts'
import type { AppEnv } from '../env.ts'
import { issueBearer, IssueConfigError } from '../issue/issue-bearer.ts'
import type { IssueContext } from '../issue/issue-bearer.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

// Annotated (not cast): the regex guarantees the 0x prefix and length, so the
// contextually typed template literal narrows to Hex directly. An unset binding
// reads as the zero value, which counts as unconfigured.
const asHex = (s: string, digits: number, zero: Hex): Hex | null => {
  if (!new RegExp(`^0x[0-9a-fA-F]{${digits}}$`, 'u').test(s)) {
    return null
  }
  const hex: Hex = `0x${s.slice(2)}`
  return hex.toLowerCase() === zero ? null : hex
}

// null means "this deployment cannot issue": ISSUER_ADDRESS / DELEGATION_UID
// unset or zero, or a malformed EAS_SCHEMAS binding. All answer 502 chain_error.
const issueContext = (c: Context<AppEnv>): IssueContext | null => {
  const issuerAddress = asHex(c.env.ISSUER_ADDRESS, 40, ZERO_ADDRESS)
  const delegationUid = asHex(c.env.DELEGATION_UID, 64, ZERO_UID)
  if (issuerAddress === null || delegationUid === null) {
    return null
  }
  let sets: ReturnType<typeof parseSchemaSets>
  try {
    sets = parseSchemaSets(c.env.EAS_SCHEMAS)
  } catch {
    return null
  }
  return {
    baseUrl: c.env.API_BASE_URL,
    chain: c.get('chain'),
    db: c.get('db'),
    delegationUid,
    issuerAddress,
    now: c.get('now')(),
    sets,
  }
}

export const issueRoutes = new Hono<AppEnv>()

// Admin-only write path. The requested `level` is never taken from the body:
// it follows from which identity key the caller supplied.
issueRoutes.post('/issue', adminAuth(), async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(IssueBody, body)
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const kind = deriveIssueKind(parsed.output)
  if (kind === null) {
    return errorResponse(c, 'bad_input', 400)
  }
  if (c.get('chain').signerAddress() === null) {
    return errorResponse(c, 'no_signer', 501)
  }
  const ctx = issueContext(c)
  if (ctx === null) {
    return errorResponse(c, 'chain_error', 502)
  }
  try {
    const { memberId } = parsed.output
    if (kind === 'bearer' && memberId !== undefined) {
      return jsonResponse(c, await issueBearer(ctx, { ...parsed.output, memberId }))
    }
    // The Signed branch lands in plan-3 and the Private branch in plan-4; both
    // replace this line. The spec defines no "not implemented" code, so until
    // then a well-formed Signed/Private request is answered as bad_input.
    return errorResponse(c, 'bad_input', 400)
  } catch (error) {
    if (error instanceof NoSignerError) {
      return errorResponse(c, 'no_signer', 501)
    }
    if (error instanceof ChainError || error instanceof IssueConfigError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw error
  }
})
