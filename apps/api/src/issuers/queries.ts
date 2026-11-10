import { asc, eq, sql } from 'drizzle-orm'

import { ACCOUNT_KEY_PREFIX } from '../auth/principal.ts'
import type { OperatorPrincipal } from '../auth/principal.ts'
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

// The columns that name an issuer's owner, for the row that creates it.
export const ownerColumns = (
  principal: OperatorPrincipal,
): { operatorAddress: string | null; ownerAccountId: string | null } =>
  principal.kind === 'account'
    ? { operatorAddress: null, ownerAccountId: principal.accountId }
    : { operatorAddress: principal.address, ownerAccountId: null }

// An issuer's owner as principalKey writes it, for comparing with the owner column of
// connected-app rows.
export const ownerKeyOf = (issuer: {
  operatorAddress: string | null
  ownerAccountId: string | null
}): string | null =>
  issuer.ownerAccountId === null ? issuer.operatorAddress : `${ACCOUNT_KEY_PREFIX}${issuer.ownerAccountId}`

// The same in SQL. The concatenation is NULL when the issuer has no account.
export const issuerOwnerKey = sql<string>`COALESCE(${ACCOUNT_KEY_PREFIX} || ${issuers.ownerAccountId}, ${issuers.operatorAddress})`

// Every issuer a principal owns, oldest first: the dashboard's profile switcher
// and the connected-app consent screen both choose from this list
// (../../../../docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route). The one place ownership is decided.
export const issuersOwnedBy = async (
  db: Db,
  principal: OperatorPrincipal,
): Promise<(typeof issuers.$inferSelect)[]> =>
  await db
    .select()
    .from(issuers)
    .where(
      principal.kind === 'account'
        ? eq(issuers.ownerAccountId, principal.accountId)
        : eq(issuers.operatorAddress, principal.address),
    )
    .orderBy(asc(issuers.createdAt), asc(issuers.id))
