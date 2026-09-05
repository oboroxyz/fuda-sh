import type { MemberRow } from '@fuda/sdk'
import { asc, desc } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Hex } from 'viem'

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
  // Annotated (not cast): attestation_uid and holder are written only from
  // validated Hex values, so these contextually typed template literals
  // narrow to Hex directly.
  const out: MemberRow[] = rows.map((r) => {
    const uid: Hex = `0x${r.attestationUid.slice(2)}`
    const holder: Hex | null = r.holder === null ? null : `0x${r.holder.slice(2)}`
    return {
      createdAt: r.createdAt,
      holder,
      level: r.level,
      memberId: r.memberId,
      status: r.status,
      tier: r.tier,
      uid,
    }
  })
  return jsonResponse(c, { members: out })
})
