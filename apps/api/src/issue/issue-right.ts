import { LEVEL_CODE, toQr } from '@fuda/sdk'
import type { IssueRequest, IssueResponse } from '@fuda/sdk'
import type { Hex } from 'viem'

import { ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
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

export interface RightParams {
  holder: Hex
  level: 'bearer' | 'signed'
  memberId: string
  body: IssueRequest
}

// The shared write path for the two public-holder levels: encode, attest
// synchronously, then (only after the receipt) insert the member row. `level`
// is a parameter of the branch, never of the request.
export const attestRight = async (ctx: IssueContext, p: RightParams): Promise<IssueResponse> => {
  const schema = newest(ctx.sets.entitlement)
  if (schema === null) {
    throw new IssueConfigError('EAS_SCHEMAS.entitlement is empty')
  }
  const data = encodeEntitlementV1({
    holder: p.holder,
    issuer: ctx.issuerAddress,
    level: LEVEL_CODE[p.level],
    metaURI: p.body.metaURI,
    serial: ZERO_UID,
    tier: p.body.tier,
    usageModel: p.body.usageModel,
    validFrom: BigInt(p.body.validFrom),
    validUntil: BigInt(p.body.validUntil),
  })
  const { uid } = await ctx.chain.attest({
    data,
    expirationTime: 0n,
    recipient: p.holder,
    refUID: ctx.delegationUid,
    revocable: true,
    schema: schema.uid,
  })
  await ctx.db.insert(members).values({
    attestationUid: uid,
    createdAt: ctx.now,
    holder: p.holder,
    level: p.level,
    memberId: p.memberId,
    status: 'active',
    tier: p.body.tier,
  })
  return { holder: p.holder, level: p.level, passUrls: passUrls(ctx.baseUrl, uid), qr: toQr(uid), uid }
}
