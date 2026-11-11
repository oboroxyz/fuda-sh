import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { cards } from '../db/schema.ts'

export const releasePlace = (db: Db, cardId: string | SQL) =>
  db
    .update(cards)
    .set({ reserved: sql`max(0, ${cards.reserved} - 1)` })
    .where(eq(cards.id, cardId))
