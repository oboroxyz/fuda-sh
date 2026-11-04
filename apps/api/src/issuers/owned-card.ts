import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'

import { cards } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'

// The signed-in operator's own Card. A session with no issuer yet owns nothing,
// and another issuer's Card reads the same as a missing one, so a route answers
// 404 to all three and never reveals that a Card exists.
export const ownedCard = async (
  c: Context<AppEnv>,
  cardId: string,
): Promise<typeof cards.$inferSelect | undefined> => {
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return undefined
  }
  return await c
    .get('db')
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.issuerId, issuerId)))
    .get()
}
