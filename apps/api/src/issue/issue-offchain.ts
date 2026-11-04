import { passUrls, toQr, asHex } from '@fuda/sdk'
import type { IssueRequest, SelfServeIssueResponse } from '@fuda/sdk'
import type { Hex } from 'viem'

import { ZERO_ADDRESS, ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { members, offchainAttestations } from '../db/schema.ts'
import {
  encodeOffchainPass,
  newOffchainMessage,
  offchainTypedData,
  offchainUid,
  toSignedJson,
} from '../eas/offchain.ts'
import type { OffchainDomain } from '../eas/offchain.ts'
import type { Bindings } from '../env.ts'

// The domain this deployment signs under and accepts. Its version and contract
// come from configuration, so issuing never reads the chain.
export const offchainDomain = (env: Pick<Bindings, 'EAS_ADDRESS' | 'EAS_VERSION'>, chain: ChainClient) => {
  const verifyingContract = asHex(env.EAS_ADDRESS, 20)
  if (verifyingContract === null) {
    return null
  }
  const domain: OffchainDomain = {
    chainId: chain.chainId(),
    name: 'EAS Attestation',
    verifyingContract,
    version: env.EAS_VERSION,
  }
  return domain
}

export interface OffchainIssueParams {
  baseUrl: string
  body: IssueRequest
  cardId: string
  chain: ChainClient
  db: Db
  domain: OffchainDomain
  issuerHandle: string
  issuerId: string
  memberNumber: string
  now: number
  source: string | null
}

// Signing needs no transaction, and nothing exists until both rows commit, so a
// failed insert leaves no orphan behind and the caller can simply answer the error.
export const issueOffchainPass = async (p: OffchainIssueParams): Promise<SelfServeIssueResponse> => {
  const message = newOffchainMessage({
    data: encodeOffchainPass({
      card: p.cardId,
      holderKey: '0x',
      level: 0,
      memberNumber: p.memberNumber,
      tier: p.body.tier,
      usageModel: p.body.usageModel,
      validFrom: BigInt(p.body.validFrom),
      validUntil: BigInt(p.body.validUntil),
      venue: p.issuerHandle,
    }),
    expirationTime: BigInt(p.body.validUntil),
    refUID: ZERO_UID,
    time: BigInt(p.now),
  })
  const signature: Hex = await p.chain.signOffchain(offchainTypedData(p.domain, message))
  const uid = offchainUid(message)
  await p.db.batch([
    p.db.insert(members).values({
      attestationUid: uid,
      cardId: p.cardId,
      createdAt: p.now,
      holder: null,
      issuerId: p.issuerId,
      level: 'bearer',
      memberId: p.memberNumber,
      source: p.source,
      status: 'active',
      tier: p.body.tier,
      usageModel: p.body.usageModel,
      validFrom: p.body.validFrom,
      validUntil: p.body.validUntil,
    }),
    p.db.insert(offchainAttestations).values({
      createdAt: p.now,
      signed: toSignedJson({ domain: p.domain, message, signature, uid }),
      uid,
    }),
  ])
  return {
    holder: ZERO_ADDRESS,
    level: 'bearer',
    memberNumber: p.memberNumber,
    passUrls: passUrls(p.baseUrl, uid),
    qr: toQr(uid),
    uid,
  }
}
