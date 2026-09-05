import type { IssueRequest, IssueResponse } from '@fuda/sdk'

import { bearerHolder } from '../chain/holder.ts'
import { attestRight } from './issue-right.ts'
import type { IssueContext } from './issue-right.ts'

export type { IssueContext } from './issue-right.ts'
export { IssueConfigError } from './issue-right.ts'

// Bearer: holder = the member's Claimable smart account (counterfactual address), level 0.
export const issueBearer = async (
  ctx: IssueContext,
  body: IssueRequest & { memberId: string },
): Promise<IssueResponse> => {
  const holder = await bearerHolder(ctx.chain, ctx.issuerAddress, body.memberId)
  return await attestRight(ctx, { body, holder, level: 'bearer', memberId: body.memberId })
}
