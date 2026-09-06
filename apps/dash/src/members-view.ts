import { passUrls, TIER_LABEL, toQr } from '@fuda/sdk'
import type { Hex, Level, MemberRow, PassUrls } from '@fuda/sdk'
import { short } from '@fuda/ui'

export interface MemberRowView {
  uid: Hex
  memberId: string
  holder: Hex | null
  holderShort: string | null
  level: Level
  tier: string
  status: 'active' | 'revoked'
  qr: string
  passUrls: PassUrls | null
}

// The QR is the right's identifier, not its credential: it is safe to show for
// every level because the gate rejects a Signed/+Private QR with LEVEL_REQUIRED.
// Private rows show memberId + uid only — there is no holder to show and no
// pass to hand out (discovery is the member's path, docs/specs/pass-types-and-flows.md#u2-privacy-first-issuance).
export const memberRowView = (row: MemberRow, apiBase: string): MemberRowView => ({
  holder: row.holder,
  holderShort: row.holder === null ? null : short(row.holder),
  level: row.level,
  memberId: row.memberId,
  passUrls: row.level === 'private' ? null : passUrls(apiBase, row.uid),
  qr: toQr(row.uid),
  status: row.status,
  tier: TIER_LABEL[row.tier] ?? `TIER ${row.tier}`,
  uid: row.uid,
})
