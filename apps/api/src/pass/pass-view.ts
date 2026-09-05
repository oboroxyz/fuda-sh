import { TIER_LABEL, toQr } from '@fuda/sdk'
import type { Level, Reason } from '@fuda/sdk'
import type { Hex } from 'viem'

export interface PassRow {
  uid: Hex
  holder: Hex | null
  level: Level
  tier: number
}

// null = the chain could not be read at render time.
export type PassOutcome = { decision: 'ADMIT' | 'REJECT'; reason: Reason } | null

export interface PassView {
  uid: Hex
  qr: string
  tier: string
  level: Level
  holderShort: string
  status: 'VALID' | 'UNKNOWN' | Reason
}

export const shortAddress = (a: Hex): string => `${a.slice(0, 6)}…${a.slice(-4)}`

const statusOf = (outcome: PassOutcome): PassView['status'] => {
  if (outcome === null) {
    return 'UNKNOWN'
  }
  return outcome.decision === 'ADMIT' ? 'VALID' : outcome.reason
}

// Pure: everything the page renders, decided here so the markup holds no logic.
export const passView = (row: PassRow, outcome: PassOutcome): PassView => ({
  holderShort: row.holder === null ? '—' : shortAddress(row.holder),
  level: row.level,
  qr: toQr(row.uid),
  status: statusOf(outcome),
  // `.at` (not an index) so a tier outside the known labels is typed as absent.
  tier: TIER_LABEL.at(row.tier) ?? `TIER ${row.tier}`,
  uid: row.uid,
})
