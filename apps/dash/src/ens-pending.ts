import { asHex } from '@fuda/sdk'
import type { EnsClaimView, Hex } from '@fuda/sdk'
import * as v from 'valibot'

import { API_BASE_URL } from './config.ts'

export interface PendingEnsClaim {
  name: string
  txHash: Hex
}
const key = (issuerId: string): string => `fuda:dash:ens:${API_BASE_URL}:${issuerId}`
const PendingClaim = v.object({ name: v.pipe(v.string(), v.minLength(1)), txHash: v.string() })

export const readPendingEnsClaim = (issuerId: string): PendingEnsClaim | null => {
  try {
    const parsed = v.safeParse(PendingClaim, JSON.parse(localStorage.getItem(key(issuerId)) ?? 'null'))
    if (!parsed.success) {
      return null
    }
    const txHash = asHex(parsed.output.txHash, 32)
    return txHash === null ? null : { name: parsed.output.name, txHash }
  } catch {
    return null
  }
}

export const writePendingEnsClaim = (issuerId: string, pending: PendingEnsClaim | null): void => {
  try {
    if (pending === null) {
      localStorage.removeItem(key(issuerId))
    } else {
      localStorage.setItem(key(issuerId), JSON.stringify(pending))
    }
  } catch {
    /* current session can still retry */
  }
}

export const reconcilePendingEnsClaim = (
  issuerId: string,
  ens: EnsClaimView | null,
): PendingEnsClaim | null => {
  const pending = readPendingEnsClaim(issuerId)
  if (pending === null) {
    return null
  }
  if (ens === null || ens.status === 'claimed' || ens.name !== pending.name) {
    writePendingEnsClaim(issuerId, null)
    return null
  }
  return pending
}
