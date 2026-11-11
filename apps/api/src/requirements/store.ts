import { CardRequirement } from '@fuda/sdk'
import type { Requirement } from '@fuda/sdk'
import { asc, inArray } from 'drizzle-orm'
import * as v from 'valibot'

import { bindChunks } from '../db/bind-chunks.ts'
import type { Db } from '../db/client.ts'
import { cardRequirements } from '../db/schema.ts'

const StoredRequirement = v.pipe(v.string(), v.parseJson(), CardRequirement)

// One row per requirement, in the order the Card body listed them. At most four per Card, so
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

// The requirements of many Cards in one pass, in batches under the same cap. A Card with
// none is absent from the map. A row that no longer parses throws rather than being dropped,
// because a Card that lost a requirement would admit what it was meant to refuse.
export const requirementsByCard = async (
  db: Db,
  cardIds: readonly string[],
): Promise<Map<string, Requirement[]>> => {
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

export const requirementsOf = async (db: Db, cardId: string): Promise<Requirement[]> => {
  const byCard = await requirementsByCard(db, [cardId])
  return byCard.get(cardId) ?? []
}
