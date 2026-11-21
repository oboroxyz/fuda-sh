import type { Requirement, RequirementDetail, RequirementKind } from '@fuda/sdk'
import type { Hex } from 'viem'

import type { ChainClient } from '../chain/client.ts'

export type CheckResult = { met: true } | { met: false; detail: RequirementDetail }
export type ClaimResult = { met: true; evidence: string } | { met: false; detail: RequirementDetail }

/** An empty page does not prove absence unless nextCursor == agreementCountOf(assetId). */
export interface RequirementAdapter {
  kind: RequirementKind
  subject: 'address'
  claimCheck: (
    chain: ChainClient,
    config: Requirement,
    holder: Hex,
    agreementId?: Hex,
  ) => Promise<ClaimResult>
  presentationCheck: (
    chain: ChainClient,
    config: Requirement,
    holder: Hex,
    evidence: string,
  ) => Promise<CheckResult>
}
