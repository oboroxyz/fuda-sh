import type { IssueRequest, IssueResponse } from '@fuda/sdk'
import { getAddress } from 'viem'

import { attestRight } from './issue-right.ts'
import type { IssueContext } from './issue-right.ts'

// Signed: holder = the member's own wallet (docs/specs/attestation-model.md#api-payloads-that-touch-attestations), stored EIP-55-checksummed
// like every other address the api writes; member_id mirrors it. level 1.
export const issueSigned = async (
  ctx: IssueContext,
  body: IssueRequest & { holder: string },
): Promise<IssueResponse> => {
  const holder = getAddress(body.holder)
  return await attestRight(ctx, { body, holder, level: 'signed', memberId: holder })
}
