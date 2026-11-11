import type { Reason } from './constants.ts'
import type { IssuerPassStatus } from './types.ts'

export interface RightFacts {
  status?: 'active' | 'revoked'
  validFrom: bigint | number | null
  validUntil: bigint | number | null
  usageModel: number | null
  consumed?: boolean
  revocationTime?: bigint
  expirationTime?: bigint
  offchainRevokedAt?: bigint
}

type RightReason = Extract<
  Reason,
  'REVOKED' | 'EXPIRED' | 'UNKNOWN_USAGE_MODEL' | 'NOT_YET_VALID' | 'ALREADY_USED' | 'WRONG_SCHEMA'
>

export interface RightStatus {
  status: IssuerPassStatus
  reason: RightReason | null
}

const hasPassed = (bound: bigint, at: bigint): boolean => bound !== 0n && at > bound

// Only facts supplied by the caller count. Absence of a chain fact is not proof
// that the chain accepts the Right. Authentication and delegation stay outside.
export const rightStatus = (facts: RightFacts, now: number): RightStatus => {
  if (
    facts.status === 'revoked' ||
    (facts.revocationTime ?? 0n) !== 0n ||
    (facts.offchainRevokedAt ?? 0n) !== 0n
  ) {
    return { reason: 'REVOKED', status: 'revoked' }
  }
  const at = BigInt(now)
  if (hasPassed(facts.expirationTime ?? 0n, at)) {
    return { reason: 'EXPIRED', status: 'expired' }
  }
  if (facts.usageModel !== null && facts.usageModel > 2) {
    return { reason: 'UNKNOWN_USAGE_MODEL', status: 'unknown' }
  }
  if (facts.validFrom === null || facts.validUntil === null || facts.usageModel === null) {
    return { reason: 'WRONG_SCHEMA', status: 'unknown' }
  }
  const from = BigInt(facts.validFrom)
  const until = BigInt(facts.validUntil)
  if (from !== 0n && at < from) {
    return { reason: 'NOT_YET_VALID', status: 'not_yet_valid' }
  }
  if (hasPassed(until, at)) {
    return { reason: 'EXPIRED', status: 'expired' }
  }
  if (facts.usageModel === 0 && facts.consumed === true) {
    return { reason: 'ALREADY_USED', status: 'consumed' }
  }
  return { reason: null, status: 'active' }
}
