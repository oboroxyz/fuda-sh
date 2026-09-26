import { asHex } from '@fuda/sdk'
import type { BadgeView, Hex, MemberRow } from '@fuda/sdk'
import { asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'

import { readBadgesByUid } from '../badges/store.ts'
import { members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { jsonResponse } from '../json.ts'
import { operatorOrAdmin } from '../middleware/operator-or-admin.ts'

export const MEMBERS_LIMIT = 200

export const membersRoutes = new Hono<AppEnv>()

// Advisory, on the same terms as `badgesFor` in the verify route: a Badge is
// extra information about a Right the operator already owns, so a missing table
// or a failed query costs the Badge column and never the pass list.
const badgesByUid = async (c: Context<AppEnv>, uids: readonly Hex[]): Promise<Map<string, BadgeView[]>> => {
  try {
    return await readBadgesByUid(c.get('db'), uids)
  } catch {
    return new Map()
  }
}

// A venue sees its own members; fuda's admin token sees the deployment's.
// Scoping by `issuer_id` rather than by card keeps a venue's second card in the
// same list (docs/specs/pass-types-and-flows.md#surfaces).
membersRoutes.get('/members', operatorOrAdmin(), async (c) => {
  const issuerId = c.get('actingIssuer')
  const scoped = c.get('db').select().from(members).$dynamic()
  const rows = await (issuerId === null ? scoped : scoped.where(eq(members.issuerId, issuerId)))
    .orderBy(desc(members.createdAt), asc(members.attestationUid))
    .limit(MEMBERS_LIMIT)
  // attestation_uid and holder are written only from validated Hex values; a row
  // that fails validation is malformed and is dropped rather than reported.
  const listed: MemberRow[] = rows.flatMap((r) => {
    const uid = asHex(r.attestationUid, 32)
    if (uid === null) {
      return []
    }
    const holder = r.holder === null ? null : asHex(r.holder, 20)
    return [
      {
        createdAt: r.createdAt,
        holder,
        level: r.level,
        memberId: r.memberId,
        status: r.status,
        tier: r.tier,
        uid,
      },
    ]
  })
  // One badge read for the whole page, after the rows are known. A Right with no
  // Badge carries no `badges` key at all, matching the verdict body, so a client
  // reading the list from before Badges existed sees the shape it expects.
  const held = await badgesByUid(
    c,
    listed.map((row) => row.uid),
  )
  const out: MemberRow[] = listed.map((row) => {
    const badges = held.get(row.uid)
    return badges === undefined ? row : { ...row, badges }
  })
  return jsonResponse(c, { members: out })
})
