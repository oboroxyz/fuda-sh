import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Hex } from 'viem'

import { ZERO_ADDRESS } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { memberPasses, members } from '../db/schema.ts'

// docs/specs/pass-types-and-flows.md#member-sign-in. Only Bearer passes link: having the
// uid is what using one means, so a link grants nothing new. A uid that names nothing,
// or a Signed right, is skipped without saying which.
export const linkPasses = async (db: Db, accountId: string, uids: readonly Hex[], now: number) => {
  if (uids.length === 0) {
    return 0
  }
  const known = await db
    .select({ uid: members.attestationUid })
    .from(members)
    .where(and(inArray(members.attestationUid, [...uids]), eq(members.level, 'bearer')))
  const [first, ...rest] = known.map(({ uid }) =>
    db.insert(memberPasses).values({ accountId, addedAt: now, uid }).onConflictDoNothing(),
  )
  if (first === undefined) {
    return 0
  }
  await db.batch([first, ...rest])
  return known.length
}

export const listPasses = async (db: Db, accountId: string) => {
  const rows = await db
    .select({ addedAt: memberPasses.addedAt, holder: members.holder, uid: memberPasses.uid })
    .from(memberPasses)
    .innerJoin(members, eq(members.attestationUid, memberPasses.uid))
    .where(eq(memberPasses.accountId, accountId))
    .orderBy(desc(memberPasses.addedAt))
  // An offchain pass has no holder; the zero address is how the api reports that.
  return rows.map((row) => ({ addedAt: row.addedAt, holder: row.holder ?? ZERO_ADDRESS, uid: row.uid }))
}
