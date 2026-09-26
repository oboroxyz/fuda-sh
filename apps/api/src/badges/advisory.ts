import type { BadgeView, Hex } from '@fuda/sdk'

import type { Db } from '../db/client.ts'
import { readBadgesByUid } from './store.ts'

// Advisory, on the same terms as `badgesFor` in the verify route: a Badge is
// extra information about a Right the operator already owns, so a missing table
// or a failed query costs the Badge column and never the list it decorates.
export const badgesByUid = async (db: Db, uids: readonly Hex[]): Promise<Map<string, BadgeView[]>> => {
  try {
    return await readBadgesByUid(db, uids)
  } catch {
    return new Map()
  }
}

// A Right with no Badge carries no `badges` key at all, matching the verdict
// body, so a client reading the list from before Badges existed sees the shape
// it expects.
export const withBadges = <T extends { uid: string; badges?: BadgeView[] }>(
  rows: readonly T[],
  held: Map<string, BadgeView[]>,
): T[] =>
  rows.map((row) => {
    const badges = held.get(row.uid)
    return badges === undefined ? row : { ...row, badges }
  })
