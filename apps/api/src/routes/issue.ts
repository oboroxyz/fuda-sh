import { deriveIssueKind, IssueBody } from '@fuda/sdk'
import { asMetaAddress } from '@fuda/stealth-address'
import { Hono } from 'hono'
import * as v from 'valibot'

import { ChainError, NoSignerError } from '../chain/client.ts'
import type { AppEnv } from '../env.ts'
import { issueBearer, IssueConfigError } from '../issue/issue-bearer.ts'
import { issueContext } from '../issue/issue-context.ts'
import { issuePrivate } from '../issue/issue-private.ts'
import { issueSigned } from '../issue/issue-signed.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

// Which of the two 4xx codes a bad meta-address earns. IssueBody's own regex
// would fold a malformed stealthMetaAddress into `bad_input`, but docs/specs/attestation-model.md#error-codes names
// `bad_meta_address` for it, so the field is peeked at before that parse.
// `asMetaAddress` runs the same 132-hex shape check META_ADDRESS_RE does and
// then the curve check, so it covers both a wrong shape and an off-curve half —
// and hands back the accepted value as `Hex`, so the private branch below never
// re-types the string.
const MetaOnly = v.object({ stealthMetaAddress: v.string() })

export const issueRoutes = new Hono<AppEnv>()

// Admin-only write path. The requested `level` is never taken from the body:
// it follows from which identity key the caller supplied.
issueRoutes.post('/issue', adminAuth(), async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const peeked = v.safeParse(MetaOnly, body)
  const metaAddress = peeked.success ? asMetaAddress(peeked.output.stealthMetaAddress) : null
  if (peeked.success && metaAddress === null) {
    return errorResponse(c, 'bad_meta_address', 400)
  }
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
    const { holder, memberId } = parsed.output
    if (kind === 'bearer' && memberId !== undefined) {
      return jsonResponse(c, await issueBearer(ctx, { ...parsed.output, memberId }))
    }
    if (kind === 'signed' && holder !== undefined) {
      return jsonResponse(c, await issueSigned(ctx, { ...parsed.output, holder }))
    }
    if (kind === 'private' && metaAddress !== null) {
      return jsonResponse(c, await issuePrivate(ctx, { ...parsed.output, stealthMetaAddress: metaAddress }))
    }
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
