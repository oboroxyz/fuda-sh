import { deriveIssueKind, IssueBody } from '@fuda/sdk'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { ChainError, NoSignerError } from '../chain/client.ts'
import { issueBearer, IssueConfigError } from '../issue/issue-bearer.ts'
import { issueContext } from '../issue/issue-context.ts'
import { issueSigned } from '../issue/issue-signed.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

// Admin-only write path. The requested `level` is never taken from the body:
// it follows from which identity key the caller supplied.
export const postV1Issue = defineHandler(adminAuth(), async (c) => {
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
    const { holder, memberId } = parsed.output
    if (kind === 'bearer' && memberId !== undefined) {
      return jsonResponse(c, await issueBearer(ctx, { ...parsed.output, memberId }))
    }
    if (kind === 'signed' && holder !== undefined) {
      return jsonResponse(c, await issueSigned(ctx, { ...parsed.output, holder }))
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
