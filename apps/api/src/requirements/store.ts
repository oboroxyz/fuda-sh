import { CardRequirement } from '@fuda/sdk'
import type { Requirement } from '@fuda/sdk'
import { asc, inArray } from 'drizzle-orm'
import * as v from 'valibot'

import { bindChunks } from '../db/bind-chunks.ts'
import type { Db } from '../db/client.ts'
import { cardRequirements } from '../db/schema.ts'
import type { cards } from '../db/schema.ts'

const StoredRequirement = v.pipe(v.string(), v.parseJson(), CardRequirement)

// One row per requirement, in the order the Card body listed them. At most one per Card, so
// the whole list binds under D1's cap on bound parameters (AGENTS.md: D1 writes).
export const requirementRows = (
  cardId: string,
  requirements: readonly Requirement[],
): (typeof cardRequirements.$inferInsert)[] =>
  requirements.map((requirement, position) => ({
    cardId,
    config: JSON.stringify(requirement),
    kind: requirement.kind,
    position,
  }))

type CardKey = Pick<typeof cards.$inferSelect, 'id' | 'hasRequirements'> &
  Partial<Pick<typeof cards.$inferSelect, 'identity'>>

export const cardHasRequirements = (card: Pick<CardKey, 'hasRequirements' | 'identity'>): boolean =>
  card.hasRequirements || card.identity === 'address'

// A Card without requirements costs no query. Invalid stored config fails closed.
export const requirementsByCard = async (
  db: Db,
  listed: readonly CardKey[],
): Promise<Map<string, Requirement[]>> => {
  const cardIds = listed.filter(cardHasRequirements).map((card) => card.id)
  const batches = await Promise.all(
    bindChunks(cardIds, 99).map(
      async (batch) =>
        await db
          .select()
          .from(cardRequirements)
          .where(inArray(cardRequirements.cardId, batch))
          .orderBy(asc(cardRequirements.cardId), asc(cardRequirements.position)),
    ),
  )
  const byCard = new Map<string, Requirement[]>()
  for (const row of batches.flat()) {
    const parsed = v.parse(StoredRequirement, row.config)
    byCard.set(row.cardId, [...(byCard.get(row.cardId) ?? []), parsed])
  }
  return byCard
}

export const requirementsOf = async (db: Db, card: CardKey): Promise<Requirement[]> => {
  const byCard = await requirementsByCard(db, [card])
  return byCard.get(card.id) ?? []
}
