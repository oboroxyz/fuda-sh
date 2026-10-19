import { asc, eq } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { cards, issuers } from '../db/schema.ts'

export interface VenueRows {
  issuer: typeof issuers.$inferSelect
  cards: (typeof cards.$inferSelect)[]
}

// The venue behind a handle with every card it has published, oldest first.
const cardsOf = async (db: Db, issuer: typeof issuers.$inferSelect): Promise<VenueRows | null> => {
  const owned = await db.select().from(cards).where(eq(cards.issuerId, issuer.id)).orderBy(cards.createdAt)
  return { cards: owned, issuer }
}

export const venueOf = async (db: Db, handle: string): Promise<VenueRows | null> => {
  const issuer = await db.select().from(issuers).where(eq(issuers.handle, handle)).get()
  return issuer === undefined ? null : await cardsOf(db, issuer)
}

export const ownedVenue = async (db: Db, issuerId: string | null): Promise<VenueRows | null> => {
  if (issuerId === null) {
    return null
  }
  const issuer = await db.select().from(issuers).where(eq(issuers.id, issuerId)).get()
  return issuer === undefined ? null : await cardsOf(db, issuer)
}

// Every issuer an account owns, oldest first: the dashboard's profile switcher
// and the connected-app consent screen both choose from this list
// (docs/adr/0009-several-issuers-per-account.md).
export const issuersOwnedBy = async (db: Db, address: string): Promise<(typeof issuers.$inferSelect)[]> =>
  await db
    .select()
    .from(issuers)
    .where(eq(issuers.operatorAddress, address))
    .orderBy(asc(issuers.createdAt), asc(issuers.id))
