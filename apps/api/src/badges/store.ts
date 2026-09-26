import type { BadgeKind, BadgeView, Hex } from '@fuda/sdk'
import { BADGE_KINDS } from '@fuda/sdk'
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

// Type guard to narrow string to BadgeKind, validating against BADGE_KINDS.
const isBadgeKind = (value: string): value is BadgeKind => BADGE_KINDS.some((kind) => kind === value)

// Build a BadgeView from database row, with kind already validated as BadgeKind.
const buildBadgeView = (row: {
  verifiedAt: number
  kind: BadgeKind
  verifier: string
  expiresAt: number | null
}): BadgeView => {
  if (row.expiresAt === null) {
    return { at: row.verifiedAt, kind: row.kind, verifier: row.verifier }
  }
  return { at: row.verifiedAt, expiresAt: row.expiresAt, kind: row.kind, verifier: row.verifier }
}

export const readBadges = async (db: Db, uid: Hex): Promise<BadgeView[]> => {
  const rows = await db.select().from(badges).where(eq(badges.uid, uid))
  const views: BadgeView[] = []
  for (const row of rows) {
    // Defensive: validate kind against schema to guard against drift or manual writes.
    // Badges are advisory and must not break reads, so unrecognized kinds are skipped.
    if (!isBadgeKind(row.kind)) {
      continue
    }
    // SAFETY: isBadgeKind check above narrows row.kind to BadgeKind
    views.push(
      buildBadgeView({
        expiresAt: row.expiresAt,
        kind: row.kind,
        verifiedAt: row.verifiedAt,
        verifier: row.verifier,
      }),
    )
  }
  return views
}

// A repeat verification is the normal case — a member taps the button twice —
// so an existing row with the same subject answers success rather than an error.
export const saveBadge = async (db: Db, input: SaveBadgeInput): Promise<SaveBadgeResult> => {
  const existing = await db
    .select()
    .from(badges)
    .where(and(eq(badges.uid, input.uid), eq(badges.kind, input.kind)))
    .get()
  if (existing !== undefined) {
    if (!isBadgeKind(existing.kind)) {
      throw new Error(`Invariant violation: badge kind not in BADGE_KINDS: ${existing.kind}`)
    }
    // SAFETY: isBadgeKind check above narrows existing.kind to BadgeKind
    return existing.subjectKey === input.subjectKey
      ? {
          badge: buildBadgeView({
            expiresAt: existing.expiresAt,
            kind: existing.kind,
            verifiedAt: existing.verifiedAt,
            verifier: existing.verifier,
          }),
          ok: true,
        }
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
  return { badge: buildBadgeView(row), ok: true }
}
