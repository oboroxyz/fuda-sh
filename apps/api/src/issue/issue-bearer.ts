import { LEVEL_CODE, toQr } from '@fuda/sdk'
import type { IssueRequest, IssueResponse } from '@fuda/sdk'
import type { Hex } from 'viem'

import { ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import { bearerHolder } from '../chain/holder.ts'
import type { Db } from '../db/client.ts'
import { members } from '../db/schema.ts'
import { encodeEntitlementV1 } from '../eas/codecs.ts'
import { newest } from '../eas/schemas.ts'
import type { SchemaSets } from '../eas/schemas.ts'
import { passUrls } from './pass-urls.ts'

export interface IssueContext {
  chain: ChainClient
  db: Db
  sets: SchemaSets
  issuerAddress: Hex
  delegationUid: Hex
  baseUrl: string
  now: number
}

export class IssueConfigError extends Error {
  override readonly name = 'IssueConfigError'
}

// Bearer: holder = the member's Claimable smart account (counterfactual address),
// level = 0. Synchronous attest; the member row is written only after the receipt.
export const issueBearer = async (
  ctx: IssueContext,
  body: IssueRequest & { memberId: string },
): Promise<IssueResponse> => {
  const schema = newest(ctx.sets.entitlement)
  if (schema === null) {
    throw new IssueConfigError('EAS_SCHEMAS.entitlement is empty')
  }
  const holder = await bearerHolder(ctx.chain, ctx.issuerAddress, body.memberId)
  const data = encodeEntitlementV1({
    holder,
    issuer: ctx.issuerAddress,
    level: LEVEL_CODE.bearer,
    metaURI: body.metaURI,
    serial: ZERO_UID,
    tier: body.tier,
    usageModel: body.usageModel,
    validFrom: BigInt(body.validFrom),
    validUntil: BigInt(body.validUntil),
  })
  const { uid } = await ctx.chain.attest({
    data,
    expirationTime: 0n,
    recipient: holder,
    refUID: ctx.delegationUid,
    revocable: true,
    schema: schema.uid,
  })
  await ctx.db.insert(members).values({
    attestationUid: uid,
    createdAt: ctx.now,
    holder,
    level: 'bearer',
    memberId: body.memberId,
    status: 'active',
    tier: body.tier,
  })
  return { holder, level: 'bearer', passUrls: passUrls(ctx.baseUrl, uid), qr: toQr(uid), uid }
}
