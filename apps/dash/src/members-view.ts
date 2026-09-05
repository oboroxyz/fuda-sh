import { TIER_LABEL, toQr } from '@fuda/sdk'
import type { Hex, Level, MemberRow, PassUrls } from '@fuda/sdk'
import { short } from '@fuda/web-kit'

export interface MemberRowView {
  uid: Hex
  memberId: string
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
// pass to hand out (discovery is the member's path, spec §7).
export const memberRowView = (row: MemberRow, apiBase: string): MemberRowView => {
  const base = apiBase.replace(/\/$/u, '')
  return {
    holderShort: row.holder === null ? null : short(row.holder),
    level: row.level,
    memberId: row.memberId,
    passUrls:
      row.level === 'private'
        ? null
        : {
            apple: `${base}/pass/${row.uid}/apple.pkpass`,
            google: `${base}/pass/${row.uid}/google`,
            web: `${base}/pass/${row.uid}`,
          },
    qr: toQr(row.uid),
    status: row.status,
    tier: TIER_LABEL[row.tier] ?? `TIER ${row.tier}`,
    uid: row.uid,
  }
}
