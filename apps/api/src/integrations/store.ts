import type { BadgeKind, CardIntegrations, Hex } from '@fuda/sdk'
import { NO_INTEGRATIONS } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'

import { bindChunks } from '../db/bind-chunks.ts'
import type { Db } from '../db/client.ts'
import { cardIntegrations, cards, members } from '../db/schema.ts'

type IntegrationRow = typeof cardIntegrations.$inferSelect

// docs/specs/pass-types-and-flows.md#card-integrations
const kindsOf = (row: Pick<IntegrationRow, 'humanBadge'> | undefined): BadgeKind[] =>
  row?.humanBadge === true ? ['human'] : []

export const readCardIntegrations = async (db: Db, cardId: string): Promise<CardIntegrations> => {
  const row = await db.select().from(cardIntegrations).where(eq(cardIntegrations.cardId, cardId)).get()
  return row === undefined ? NO_INTEGRATIONS : { badges: kindsOf(row) }
}

// Upsert, with the ownership predicate inside the write: a Card that is not the
// operator's inserts nothing and answers as unknown.
export const writeCardIntegrations = async (
  raw: D1Database,
  db: Db,
  cardId: string,
  issuerId: string,
  value: CardIntegrations,
): Promise<CardIntegrations | null> => {
  const written = await raw
    .prepare(
      `INSERT INTO card_integrations (card_id, human_badge)
       SELECT id, ?1 FROM cards WHERE id = ?2 AND issuer_id = ?3
       ON CONFLICT(card_id) DO UPDATE SET human_badge = excluded.human_badge`,
    )
    .bind(value.badges.includes('human') ? 1 : 0, cardId, issuerId)
    .run()
  return written.meta.changes === 0 ? null : await readCardIntegrations(db, cardId)
}

// The enabled Badge kinds of many Cards at once, for a venue payload that lists
// them all. A Card without a row is simply absent from the map. The ids are read
// in batches under D1's bound-parameter cap (AGENTS.md: D1 writes).
export const badgeKindsByCard = async (
  db: Db,
  cardIds: readonly string[],
): Promise<Map<string, BadgeKind[]>> => {
  const batches = await Promise.all(
    bindChunks(cardIds).map(
      async (batch) =>
        await db.select().from(cardIntegrations).where(inArray(cardIntegrations.cardId, batch)),
    ),
  )
  return new Map(batches.flat().map((row) => [row.cardId, kindsOf(row)]))
}

// Whether a Right may carry a Badge of this kind under its Card's integrations.
// A Right issued outside any Card (the admin path) has no integrations to
// consult and keeps the pre-integration behaviour; a Right under a Card needs
// that Card to have turned the kind on.
export const cardAllowsBadge = async (db: Db, uid: Hex, kind: BadgeKind): Promise<boolean> => {
  const row = await db
    .select({ cardId: members.cardId, humanBadge: cardIntegrations.humanBadge })
    .from(members)
    .leftJoin(cards, and(eq(cards.id, members.cardId), eq(cards.issuerId, members.issuerId)))
    .leftJoin(cardIntegrations, eq(cardIntegrations.cardId, cards.id))
    .where(eq(members.attestationUid, uid))
    .get()
  if (row === undefined || row.cardId === null) {
    return true
  }
  return kindsOf({ humanBadge: row.humanBadge ?? false }).includes(kind)
}
