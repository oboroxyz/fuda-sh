import { USAGE_MODEL } from '@fuda/sdk'
import type { Reason } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'

import { ChainError, ZERO_ADDRESS, ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { issuers, members, offchainAttestations } from '../db/schema.ts'
import type { Entitlement } from '../eas/codecs.ts'
import {
  decodeHolderKey,
  decodeOffchainPass,
  fromSignedJson,
  holderAddressOf,
  OFFCHAIN_PASS_SCHEMA_UID,
  offchainUid,
  recoverOffchainSigner,
} from '../eas/offchain.ts'
import type { AttestedPasskey, OffchainDomain, OffchainPassData, SignedOffchain } from '../eas/offchain.ts'
import { checkWindow, toEntitlementView } from './verify-uid.ts'
import type { VerifyOutcome } from './verify-uid.ts'

export interface OffchainRow {
  cardId: string | null
  handle: string | null
  signed: string
  status: 'active' | 'revoked'
}

// null for a uid with no offchain row, which is then an on-chain question.
export const loadOffchainRow = async (db: Db, uid: Hex): Promise<OffchainRow | null> =>
  (await db
    .select({
      cardId: members.cardId,
      handle: issuers.handle,
      signed: offchainAttestations.signed,
      status: members.status,
    })
    .from(offchainAttestations)
    .innerJoin(members, eq(members.attestationUid, offchainAttestations.uid))
    .leftJoin(issuers, eq(issuers.id, members.issuerId))
    .where(eq(offchainAttestations.uid, uid))
    .get()) ?? null

const decodeOrNull = (data: Hex): OffchainPassData | null => {
  try {
    return decodeOffchainPass(data)
  } catch {
    return null
  }
}

// What a stored pass answers to, or null for one that answers to none.
export const attestedPasskeyOf = (row: Pick<OffchainRow, 'signed'>): AttestedPasskey | null => {
  const signed = fromSignedJson(row.signed)
  const pass = signed === null ? null : decodeOrNull(signed.message.data)
  return pass === null ? null : decodeHolderKey(pass.holderKey)
}

const sameHex = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const sameDomain = (a: OffchainDomain, b: OffchainDomain): boolean =>
  a.chainId === b.chainId &&
  a.name === b.name &&
  a.version === b.version &&
  sameHex(a.verifyingContract, b.verifyingContract)

const toCanonical = (p: OffchainPassData, attester: Hex): Entitlement => ({
  holder: ZERO_ADDRESS,
  issuer: attester,
  level: p.level,
  metaURI: '',
  schemaVersion: 1,
  serial: ZERO_UID,
  tier: p.tier,
  usageModel: p.usageModel,
  validFrom: p.validFrom,
  validUntil: p.validUntil,
})

export interface OffchainVerifyDeps {
  chain: ChainClient
  domain: OffchainDomain | null
  now: number
}

// The row is what fuda signed: right uid, right domain, right key.
const signatureReason = async (
  deps: OffchainVerifyDeps,
  uid: Hex,
  signed: SignedOffchain,
  attester: Hex | null,
): Promise<Reason | null> => {
  if (!sameHex(offchainUid(signed.message), uid) || !sameHex(signed.uid, uid)) {
    return 'BAD_SIGNATURE'
  }
  if (deps.domain === null || attester === null) {
    return 'DELEGATION_CONFIG_MISSING'
  }
  if (!sameDomain(signed.domain, deps.domain)) {
    return 'BAD_SIGNATURE'
  }
  const signer = await recoverOffchainSigner(signed)
  if (signer === null) {
    return 'BAD_SIGNATURE'
  }
  return sameHex(signer, attester) ? null : 'ISSUER_NOT_DELEGATED'
}

// The signed venue and card must be the ones the uid was looked up under, because
// every venue shares one attester and a signature alone would not tell them apart.
const bindingReason = (signed: SignedOffchain, pass: OffchainPassData, row: OffchainRow): Reason | null =>
  sameHex(signed.message.schema, OFFCHAIN_PASS_SCHEMA_UID) &&
  pass.venue === row.handle &&
  pass.card === row.cardId
    ? null
    : 'WRONG_SCHEMA'

const validityReason = (signed: SignedOffchain, canonical: Entitlement, now: number): Reason | null => {
  const expiry = signed.message.expirationTime
  return expiry !== 0n && BigInt(now) > expiry ? 'EXPIRED' : checkWindow(canonical, now)
}

// docs/specs/attestation-model.md#offchain-rights: the order is the contract. D1's
// revocation record comes first so a revoked pass stays rejected while the chain
// cannot be read. A ChainError leaves here only for a single-use right or a Sensitive pass,
// which then answer 502 like an on-chain read.
export const verifyOffchain = async (
  deps: OffchainVerifyDeps,
  uid: Hex,
  row: OffchainRow,
): Promise<VerifyOutcome> => {
  const signed = fromSignedJson(row.signed)
  const pass = signed === null ? null : decodeOrNull(signed.message.data)
  if (signed === null || pass === null) {
    return { decision: 'REJECT', reason: 'WRONG_SCHEMA' }
  }
  const attester = deps.chain.offchainAttester()
  const canonical = toCanonical(pass, attester ?? ZERO_ADDRESS)
  const reject = (reason: Reason): VerifyOutcome => ({
    decision: 'REJECT',
    entitlement: toEntitlementView(canonical),
    reason,
  })
  if (row.status === 'revoked') {
    return reject('REVOKED')
  }
  const reason =
    (await signatureReason(deps, uid, signed, attester)) ??
    bindingReason(signed, pass, row) ??
    validityReason(signed, canonical, deps.now)
  if (reason !== null || attester === null) {
    return reject(reason ?? 'DELEGATION_CONFIG_MISSING')
  }
  const holderAddress = holderAddressOf(pass.holderKey)
  const admit: VerifyOutcome = {
    attester,
    canonical,
    decision: 'ADMIT',
    delegation: { active: true, issuer: attester, name: 'fuda' },
    entitlement: toEntitlementView(canonical),
    holderAddress,
    passkey: decodeHolderKey(pass.holderKey),
    reason: 'OK',
  }
  try {
    const revokedAt = await deps.chain.offchainRevokedAt(attester, uid)
    return revokedAt === 0n ? admit : reject('REVOKED')
  } catch (error) {
    if (error instanceof ChainError && pass.usageModel !== USAGE_MODEL.SINGLE_USE && holderAddress === null) {
      return { ...admit, unconfirmed: true }
    }
    throw error
  }
}
