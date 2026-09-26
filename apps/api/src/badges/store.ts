import type { BadgeKind, BadgeView, Hex } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { badges } from '../db/schema.ts'

export interface SaveBadgeInput {
  uid: Hex
  kind: BadgeKind
  verifier: string
  scope: string
  subjectKey: string
  credential: string
  verifiedAt: number
  expiresAt: number | null
}

// 'subject' — this subject already badged another Right in this scope.
// 'pass'    — this Right already carries a badge of this kind, from someone else.
export type SaveBadgeResult = { ok: true; badge: BadgeView } | { ok: false; conflict: 'subject' | 'pass' }

const view = (row: typeof badges.$inferSelect): BadgeView => ({
  at: row.verifiedAt,
  kind: row.kind as BadgeKind,
  verifier: row.verifier,
  ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
})

export const readBadges = async (db: Db, uid: Hex): Promise<BadgeView[]> =>
  (await db.select().from(badges).where(eq(badges.uid, uid))).map(view)

// A repeat verification is the normal case — a member taps the button twice —
// so an existing row with the same subject answers success rather than an error.
export const saveBadge = async (db: Db, input: SaveBadgeInput): Promise<SaveBadgeResult> => {
  const existing = await db
    .select()
    .from(badges)
    .where(and(eq(badges.uid, input.uid), eq(badges.kind, input.kind)))
    .get()
  if (existing !== undefined) {
    return existing.subjectKey === input.subjectKey
      ? { badge: view(existing), ok: true }
      : { conflict: 'pass', ok: false }
  }
  const held = await db
    .select()
    .from(badges)
    .where(
      and(
        eq(badges.verifier, input.verifier),
        eq(badges.scope, input.scope),
        eq(badges.subjectKey, input.subjectKey),
      ),
    )
    .get()
  if (held !== undefined) {
    return { conflict: 'subject', ok: false }
  }
  const row = {
    credential: input.credential,
    expiresAt: input.expiresAt,
    kind: input.kind,
    scope: input.scope,
    subjectKey: input.subjectKey,
    uid: input.uid,
    verifiedAt: input.verifiedAt,
    verifier: input.verifier,
  }
  // Two simultaneous requests both pass the reads above; the unique index is
  // the authority and the loser re-resolves rather than throwing.
  try {
    await db.insert(badges).values(row)
  } catch {
    return await saveBadge(db, input)
  }
  return { badge: view(row), ok: true }
}
