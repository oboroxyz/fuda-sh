import { LEVEL_CODE, passUrls, toQr } from '@fuda/sdk'
import type { IssueRequest, IssueResponse, Level } from '@fuda/sdk'
import type { Hex } from 'viem'

import { ChainError, ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { members } from '../db/schema.ts'
import { encodeEntitlementV1 } from '../eas/codecs.ts'
import { newest } from '../eas/schemas.ts'
import type { SchemaSets } from '../eas/schemas.ts'

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

export interface EntitlementParams {
  holder: Hex
  level: Level
  body: IssueRequest
}

// Encode and attest synchronously; the caller decides what to persist. Shared by
// the two public-holder levels and by +Private, whose holder is a one-time
// stealth address. `level` is a parameter of the branch, never of the request.
export const attestEntitlement = async (ctx: IssueContext, p: EntitlementParams): Promise<{ uid: Hex }> => {
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
  return await ctx.chain.attest({
    data,
    expirationTime: 0n,
    recipient: p.holder,
    refUID: ctx.delegationUid,
    revocable: true,
    schema: schema.uid,
  })
}

export interface MemberRowParams {
  uid: Hex
  holder: Hex | null
  level: Level
  memberId: string
  tier: number
}

// The members insert after a successful attest. The attestation is already on
// chain by the time this runs, so a failing insert (an attestation_uid that
// collides with an existing row, a db outage) leaves a right nothing in fuda's
// tables knows about. The uid is logged because it is the only handle an
// operator has on that orphan, and the caller is told the chain leg is the
// problem: 502, not an unhandled 500.
export const insertMemberRow = async (ctx: IssueContext, row: MemberRowParams): Promise<void> => {
  try {
    await ctx.db.insert(members).values({
      attestationUid: row.uid,
      createdAt: ctx.now,
      holder: row.holder,
      level: row.level,
      memberId: row.memberId,
      status: 'active',
      tier: row.tier,
    })
  } catch (error) {
    // oxlint-disable-next-line no-console -- the orphaned attestation uid is the only trace of an on-chain right with no member row
    console.error('members insert failed after attest', { error, uid: row.uid })
    throw new ChainError(`members insert failed for attestation ${row.uid}`)
  }
}

export interface RightParams {
  holder: Hex
  level: 'bearer' | 'signed'
  memberId: string
  body: IssueRequest
}

// The shared write path for the two public-holder levels: attest, then (only
// after the receipt) insert the member row and hand back the pass.
export const attestRight = async (ctx: IssueContext, p: RightParams): Promise<IssueResponse> => {
  const { uid } = await attestEntitlement(ctx, { body: p.body, holder: p.holder, level: p.level })
  await insertMemberRow(ctx, {
    holder: p.holder,
    level: p.level,
    memberId: p.memberId,
    tier: p.body.tier,
    uid,
  })
  return { holder: p.holder, level: p.level, passUrls: passUrls(ctx.baseUrl, uid), qr: toQr(uid), uid }
}
