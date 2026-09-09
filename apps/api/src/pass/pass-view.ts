import type { PassBranding } from '@fuda/pass'
import { TIER_LABEL, toQr } from '@fuda/sdk'
import type { Level, Reason, StampSummary } from '@fuda/sdk'
import type { Hex } from 'viem'

export interface PassRow {
  uid: Hex
  holder: Hex | null
  level: Level
  tier: number
  // the venue card a self-serve right was issued under; null for admin issuance
  branding: PassBranding | null
  // where the venue's logo objects live, for the builders that embed bytes
  logoPrefix: string | null
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
  branding: PassBranding | null
  stamps: StampSummary | null
}

export const shortAddress = (a: Hex): string => `${a.slice(0, 6)}…${a.slice(-4)}`

const statusOf = (outcome: PassOutcome): PassView['status'] => {
  if (outcome === null) {
    return 'UNKNOWN'
  }
  return outcome.decision === 'ADMIT' ? 'VALID' : outcome.reason
}

// Pure: everything the page renders, decided here so the markup holds no logic.
export const passView = (
  row: PassRow,
  outcome: PassOutcome,
  stamps: StampSummary | null = null,
): PassView => ({
  branding: row.branding,
  holderShort: row.holder === null ? '—' : shortAddress(row.holder),
  level: row.level,
  qr: toQr(row.uid),
  stamps,
  status: statusOf(outcome),
  // Indexed (not `.at`), which would wrap a negative tier round to FOUNDER;
  // an unknown tier falls back to its number, as the gate and dash views do.
  tier: TIER_LABEL[row.tier] ?? `TIER ${row.tier}`,
  uid: row.uid,
})
