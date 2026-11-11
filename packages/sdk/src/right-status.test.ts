import { describe, expect, it } from 'vitest'

import { rightStatus } from './right-status.ts'
import type { RightFacts } from './right-status.ts'

const cases: [string, Partial<RightFacts>, string, string | null][] = [
  ['active unbounded', {}, 'active', null],
  ['revocation first', { expirationTime: 1n, status: 'revoked', usageModel: 3 }, 'revoked', 'REVOKED'],
  ['chain revocation first', { expirationTime: 1n, revocationTime: 1n }, 'revoked', 'REVOKED'],
  ['offchain revocation first', { expirationTime: 1n, offchainRevokedAt: 1n }, 'revoked', 'REVOKED'],
  ['EAS expiry before unknown model', { expirationTime: 1n, usageModel: 3 }, 'expired', 'EXPIRED'],
  ['EAS expiry before missing metadata', { expirationTime: 1n, validFrom: null }, 'expired', 'EXPIRED'],
  ['unknown model before window', { usageModel: 3, validFrom: 101n }, 'unknown', 'UNKNOWN_USAGE_MODEL'],
  ['missing metadata before window', { validFrom: 101n, validUntil: null }, 'unknown', 'WRONG_SCHEMA'],
  ['start before end', { validFrom: 101n, validUntil: 99n }, 'not_yet_valid', 'NOT_YET_VALID'],
  ['end before consumption', { consumed: true, usageModel: 0, validUntil: 99n }, 'expired', 'EXPIRED'],
  ['single use consumed', { consumed: true, usageModel: 0 }, 'consumed', 'ALREADY_USED'],
  ['multi use ignores slot', { consumed: true }, 'active', null],
  ['metered ignores slot', { consumed: true, usageModel: 2 }, 'active', null],
  ['inclusive boundaries', { expirationTime: 100n, validFrom: 100n, validUntil: 100n }, 'active', null],
  ['uint64 precision', { expirationTime: 18_446_744_073_709_551_615n }, 'active', null],
]

describe(rightStatus, () => {
  it.each(cases)('%s', (_name, facts, status, reason) => {
    expect(rightStatus({ usageModel: 1, validFrom: 0n, validUntil: 0n, ...facts }, 100)).toStrictEqual({
      reason,
      status,
    })
  })
})
