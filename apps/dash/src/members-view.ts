import { passUrls, TIER_LABEL, toQr } from '@fuda/sdk'
import type { Hex, Level, MemberRow, PassUrls } from '@fuda/sdk'
import { short } from '@fuda/ui/short'

import { hasHumanBadge } from './badges-view.ts'

export interface MemberRowView {
  uid: Hex
  memberId: string
  holder: Hex | null
  holderShort: string | null
  // Whether the Right carries a `human` Badge, asked of the Badge list the api
  // sends (see `hasHumanBadge`).
  human: boolean
  level: Level
  tier: string
  status: 'active' | 'revoked'
  // null for a Sensitive pass, which has no QR or pass to hand out.
  qr: string | null
  passUrls: PassUrls | null
}

// The QR is the right's identifier, not its credential: it is safe to show for
// every level because the gate rejects a Signed/+Private QR with LEVEL_REQUIRED.
// Private rows show memberId + uid only — there is no holder to show and no
// pass to hand out (discovery is the member's path, docs/specs/pass-types-and-flows.md#u2-privacy-first-issuance).
export const memberRowView = (row: MemberRow, apiBase: string): MemberRowView => ({
  holder: row.holder,
  holderShort: row.holder === null ? null : short(row.holder),
  human: hasHumanBadge(row.badges),
  level: row.level,
  memberId: row.memberId,
  passUrls: row.level === 'private' || row.sensitive === true ? null : passUrls(apiBase, row.uid),
  qr: row.sensitive === true ? null : toQr(row.uid),
  status: row.status,
  tier: TIER_LABEL[row.tier] ?? `TIER ${row.tier}`,
  uid: row.uid,
})
