import { rightStatus, USAGE_MODEL } from '@fuda/sdk'
import type { Reason } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'

import { ChainError, ZERO_ADDRESS, ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cards, issuers, members, offchainAttestations } from '../db/schema.ts'
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
import { toEntitlementView } from './verify-uid.ts'
import type { VerifyOutcome } from './verify-uid.ts'

export interface OffchainRow {
  hasRequirements?: boolean | null
  cardId: string | null
  handle: string | null
  signed: string
  status: 'active' | 'revoked'
}

// null for a uid with no offchain row, which is then an on-chain question.
export const loadVerificationRow = async (db: Db, uid: Hex) =>
  (await db
    .select({
      cardId: members.cardId,
      handle: issuers.handle,
      hasRequirements: cards.hasRequirements,
      signed: offchainAttestations.signed,
      status: members.status,
    })
    .from(members)
    .leftJoin(offchainAttestations, eq(members.attestationUid, offchainAttestations.uid))
    .leftJoin(cards, eq(cards.id, members.cardId))
    .leftJoin(issuers, eq(issuers.id, members.issuerId))
    .where(eq(members.attestationUid, uid))
    .get()) ?? null

export const loadOffchainRow = async (db: Db, uid: Hex): Promise<OffchainRow | null> => {
  const row = await loadVerificationRow(db, uid)
  return row?.signed == null ? null : { ...row, signed: row.signed }
}

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
  retiredSigners: readonly Hex[]
}

// The row is what fuda signed: right uid, right domain, right key.
const signatureReason = (
  deps: OffchainVerifyDeps,
  uid: Hex,
  signed: SignedOffchain,
  attester: Hex | null,
): Reason | null => {
  if (!sameHex(offchainUid(signed.message), uid) || !sameHex(signed.uid, uid)) {
    return 'BAD_SIGNATURE'
  }
  const current = deps.chain.offchainAttester()
  if (deps.domain === null || current === null) {
    return 'DELEGATION_CONFIG_MISSING'
  }
  if (!sameDomain(signed.domain, deps.domain)) {
    return 'BAD_SIGNATURE'
  }
  if (attester === null) {
    return 'BAD_SIGNATURE'
  }
  return sameHex(attester, current) || deps.retiredSigners.some((signer) => sameHex(signer, attester))
    ? null
    : 'ISSUER_NOT_DELEGATED'
}

// The signed venue and card must be the ones the uid was looked up under, because
// every venue shares one attester and a signature alone would not tell them apart.
const bindingReason = (signed: SignedOffchain, pass: OffchainPassData, row: OffchainRow): Reason | null =>
  sameHex(signed.message.schema, OFFCHAIN_PASS_SCHEMA_UID) &&
  pass.venue === row.handle &&
  pass.card === row.cardId
    ? null
    : 'WRONG_SCHEMA'

// EAS keys revocations by sender. A retry after rotation records under the
// current key; it cannot write the original signer's record.
const revokedOnChain = async (chain: ChainClient, attester: Hex, uid: Hex): Promise<boolean> => {
  const revokedAt = await chain.offchainRevokedAt(attester, uid)
  if (revokedAt !== 0n) {
    return true
  }
  const current = chain.offchainAttester()
  if (current === null || sameHex(current, attester)) {
    return false
  }
  return (await chain.offchainRevokedAt(current, uid)) !== 0n
}

const readRevocation = async (chain: ChainClient, attester: Hex, uid: Hex): Promise<boolean | ChainError> => {
  try {
    return await revokedOnChain(chain, attester, uid)
  } catch (error) {
    if (error instanceof ChainError) {
      return error
    }
    throw error
  }
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
  const attester = await recoverOffchainSigner(signed)
  const canonical = toCanonical(pass, attester ?? ZERO_ADDRESS)
  const reject = (reason: Reason): VerifyOutcome => ({
    decision: 'REJECT',
    entitlement: toEntitlementView(canonical),
    reason,
  })
  if (rightStatus({ ...canonical, status: row.status }, deps.now).status === 'revoked') {
    return reject('REVOKED')
  }
  const reason = signatureReason(deps, uid, signed, attester) ?? bindingReason(signed, pass, row)
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
  const revoked = await readRevocation(deps.chain, attester, uid)
  const verdict = rightStatus(
    {
      ...canonical,
      expirationTime: signed.message.expirationTime,
      offchainRevokedAt: revoked === true ? 1n : 0n,
    },
    deps.now,
  )
  if (verdict.reason !== null) {
    return reject(verdict.reason)
  }
  if (revoked instanceof ChainError) {
    if (row.hasRequirements || pass.usageModel === USAGE_MODEL.SINGLE_USE || holderAddress !== null) {
      throw revoked
    }
    return { ...admit, unconfirmed: true }
  }
  return admit
}
