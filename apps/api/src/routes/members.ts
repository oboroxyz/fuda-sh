import { asHex } from '@fuda/sdk'
import type { MemberRow } from '@fuda/sdk'
import { asc, desc } from 'drizzle-orm'
import { Hono } from 'hono'

import { members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

export const MEMBERS_LIMIT = 200

export const membersRoutes = new Hono<AppEnv>()

membersRoutes.get('/members', adminAuth(), async (c) => {
  const rows = await c
    .get('db')
    .select()
    .from(members)
    .orderBy(desc(members.createdAt), asc(members.attestationUid))
    .limit(MEMBERS_LIMIT)
  // attestation_uid and holder are written only from validated Hex values; a row
  // that fails validation is malformed and is dropped rather than reported.
  const out: MemberRow[] = rows.flatMap((r) => {
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
  return jsonResponse(c, { members: out })
})
