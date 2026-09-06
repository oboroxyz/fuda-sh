import type { DelegationView, EntitlementView, Reason } from '@fuda/sdk'
import type { Hex } from 'viem'

import { ZERO_ADDRESS, ZERO_UID } from '../chain/client.ts'
import type { ChainClient, RawAttestation } from '../chain/client.ts'
import { decodeDelegation, decodeEntitlement } from '../eas/codecs.ts'
import type { Delegation, Entitlement } from '../eas/codecs.ts'
import { findVersion } from '../eas/schemas.ts'
import type { VerifyDeps } from './config.ts'

export type { VerifyDeps } from './config.ts'

export type VerifyOutcome =
  | {
      decision: 'REJECT'
      reason: Reason
      entitlement?: EntitlementView
      delegation?: DelegationView
      attester?: Hex
    }
  | {
      decision: 'ADMIT'
      reason: 'OK'
      entitlement: EntitlementView
      delegation: DelegationView
      attester: Hex
      canonical: Entitlement
    }

export const toEntitlementView = (e: Entitlement): EntitlementView => ({
  holder: e.holder,
  issuer: e.issuer,
  level: e.level,
  schemaVersion: e.schemaVersion,
  tier: e.tier,
  usageModel: e.usageModel,
  validFrom: Number(e.validFrom),
  validUntil: Number(e.validUntil),
})

const sameAddress = (a: Hex, b: Hex): boolean => a.toLowerCase() === b.toLowerCase()

const readOrNull = async (chain: ChainClient, uid: Hex): Promise<RawAttestation | null> => {
  try {
    return await chain.readAttestation(uid)
  } catch {
    return null
  }
}

// EAS does not validate an attestation's `data` against its schema, so anyone can
// attest arbitrary bytes under a public schema UID. A decode failure is therefore a
// normal, attacker-reachable input, not a bug: it must stay decision-shaped.
const decodeEntitlementOrNull = (version: number, data: Hex): Entitlement | null => {
  try {
    return decodeEntitlement(version, data)
  } catch {
    return null
  }
}

const decodeDelegationOrNull = (version: number, data: Hex): Delegation | null => {
  try {
    return decodeDelegation(version, data)
  } catch {
    return null
  }
}

type DelegationResult = { ok: true; view: DelegationView } | { ok: false; reason: Reason }

// The authority boundary: the Entitlement's refUID must be a live IssuerDelegation
// attested by ISSUER_ADDRESS whose `issuer` field is the Entitlement's attester.
// Every failure mode here fails closed.
const checkDelegation = async (deps: VerifyDeps, refUID: Hex, attester: Hex): Promise<DelegationResult> => {
  if (sameAddress(deps.issuerAddress, ZERO_ADDRESS) || deps.sets.issuerDelegation.length === 0) {
    return { ok: false, reason: 'DELEGATION_CONFIG_MISSING' }
  }
  if (refUID === ZERO_UID) {
    return { ok: false, reason: 'NO_DELEGATION' }
  }
  const raw = await readOrNull(deps.chain, refUID)
  if (raw === null) {
    return { ok: false, reason: 'DELEGATION_UNAVAILABLE' }
  }
  const version = findVersion(deps.sets.issuerDelegation, raw.schema)
  if (
    raw.uid === ZERO_UID ||
    version === null ||
    raw.revocationTime !== 0n ||
    !sameAddress(raw.attester, deps.issuerAddress)
  ) {
    return { ok: false, reason: 'NO_DELEGATION' }
  }
  const d = decodeDelegationOrNull(version.version, raw.data)
  if (d === null || !d.active) {
    return { ok: false, reason: 'NO_DELEGATION' }
  }
  if (!sameAddress(d.issuer, attester)) {
    return { ok: false, reason: 'ISSUER_NOT_DELEGATED' }
  }
  return { ok: true, view: { active: d.active, issuer: d.issuer, name: d.name } }
}

// The usage model and validity window, in §6 table order. 0 means unbounded on
// both ends of the window, and both bounds are inclusive.
const checkWindow = (e: Entitlement, now: number): Reason | null => {
  if (e.usageModel > 2) {
    return 'UNKNOWN_USAGE_MODEL'
  }
  const at = BigInt(now)
  if (e.validFrom !== 0n && at < e.validFrom) {
    return 'NOT_YET_VALID'
  }
  if (e.validUntil !== 0n && at > e.validUntil) {
    return 'EXPIRED'
  }
  return null
}

// §6: EAS.getAttestation, then the checks in table order. The first failure is
// the reported reason. Level and slot checks belong to the routes (they differ
// per entry path); this function never rejects on level.
export const verifyUid = async (deps: VerifyDeps, uid: Hex): Promise<VerifyOutcome> => {
  // A ChainError here propagates to the caller, which answers 502 chain_error.
  const raw = await deps.chain.readAttestation(uid)
  if (raw.uid === ZERO_UID) {
    return { decision: 'REJECT', reason: 'NOT_FOUND' }
  }
  const version = findVersion(deps.sets.entitlement, raw.schema)
  if (version === null) {
    return { decision: 'REJECT', reason: 'WRONG_SCHEMA' }
  }
  const canonical = decodeEntitlementOrNull(version.version, raw.data)
  if (canonical === null) {
    // §6 puts "decode and upcast to canonical" inside the WRONG_SCHEMA row.
    return { attester: raw.attester, decision: 'REJECT', reason: 'WRONG_SCHEMA' }
  }
  const entitlement = toEntitlementView(canonical)
  const reject = (reason: Reason): VerifyOutcome => ({
    attester: raw.attester,
    decision: 'REJECT',
    entitlement,
    reason,
  })
  if (raw.revocationTime !== 0n) {
    return reject('REVOKED')
  }
  // EAS-level expiry on the attestation itself, distinct from the schema's
  // validUntil. fuda's own /issue pins it to 0; a delegated third-party
  // attester may set it, and EAS does not reject reads of an expired uid.
  if (raw.expirationTime !== 0n && BigInt(deps.now) > raw.expirationTime) {
    return reject('EXPIRED')
  }
  const windowReason = checkWindow(canonical, deps.now)
  if (windowReason !== null) {
    return reject(windowReason)
  }
  const delegation = await checkDelegation(deps, raw.refUID, raw.attester)
  if (!delegation.ok) {
    return reject(delegation.reason)
  }
  return {
    attester: raw.attester,
    canonical,
    decision: 'ADMIT',
    delegation: delegation.view,
    entitlement,
    reason: 'OK',
  }
}
