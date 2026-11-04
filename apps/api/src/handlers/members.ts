import { asHex } from '@fuda/sdk'
import type { MemberRow } from '@fuda/sdk'
import { asc, desc, eq } from 'drizzle-orm'
import { defineHandler } from 'void'

import { badgesByUid, withBadges } from '../badges/advisory.ts'
import { cards, members } from '../db/schema.ts'
import { jsonResponse } from '../json.ts'
import { operatorOrAdmin } from '../middleware/operator-or-admin.ts'

const MEMBERS_LIMIT = 200

// A venue sees its own members; fuda's admin token sees the deployment's.
// Scoping by `issuer_id` rather than by card keeps a venue's second card in the
// same list (docs/specs/pass-types-and-flows.md#surfaces).
export const getV1Members = defineHandler(operatorOrAdmin(), async (c) => {
  const issuerId = c.get('actingIssuer')
  const scoped = c
    .get('db')
    .select({ identity: cards.identity, member: members })
    .from(members)
    .leftJoin(cards, eq(cards.id, members.cardId))
    .$dynamic()
  const rows = await (issuerId === null ? scoped : scoped.where(eq(members.issuerId, issuerId)))
    .orderBy(desc(members.createdAt), asc(members.attestationUid))
    .limit(MEMBERS_LIMIT)
  // attestation_uid and holder are written only from validated Hex values; a row
  // that fails validation is malformed and is dropped rather than reported.
  const listed: MemberRow[] = rows.flatMap(({ identity, member: r }) => {
    const uid = asHex(r.attestationUid, 32)
    if (uid === null) {
      return []
    }
    const holder = r.holder === null ? null : asHex(r.holder, 20)
    const row: MemberRow = {
      createdAt: r.createdAt,
      holder,
      level: r.level,
      memberId: r.memberId,
      status: r.status,
      tier: r.tier,
      uid,
    }
    return [identity === 'sensitive' ? { ...row, sensitive: true } : row]
  })
  // One badge read for the whole page, after the rows are known.
  const held = await badgesByUid(
    c.get('db'),
    listed.map((row) => row.uid),
  )
  return jsonResponse(c, { members: withBadges(listed, held) })
})
