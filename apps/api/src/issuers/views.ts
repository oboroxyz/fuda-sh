import { isClaimable } from '@fuda/sdk'
import type { CardView, IssuerView, OperatorCardView, PublicVenue } from '@fuda/sdk'
import type { Hex } from 'viem'

import type { cards, issuers } from '../db/schema.ts'
import { logoUrlFor } from '../media/logo.ts'

type IssuerRow = typeof issuers.$inferSelect
type CardRow = typeof cards.$inferSelect

export const issuerView = (row: IssuerRow, baseUrl: string): IssuerView => {
  // Annotated (not cast): written only from ADDRESS_RE-validated input.
  const operatorAddress: Hex = `0x${row.operatorAddress.slice(2)}`
  return {
    brandColor: row.brandColor,
    createdAt: row.createdAt,
    handle: row.handle,
    id: row.id,
    logoUrl: logoUrlFor(baseUrl, row.handle, row.logoPrefix),
    name: row.name,
    operatorAddress,
    tagline: row.tagline,
  }
}

// `claimable` is decided against the api's clock, not the caller's.
export const cardView = (row: CardRow, now: number): CardView => ({
  category: row.category,
  claimFrom: row.claimFrom,
  claimUntil: row.claimUntil,
  claimable: isClaimable(row, now),
  description: row.description,
  id: row.id,
  slug: row.slug,
  title: row.title,
  validFrom: row.validFrom,
  validUntil: row.validUntil,
  validityDays: row.validityDays,
})

export const operatorCardView = (row: CardRow, now: number): OperatorCardView => ({
  ...cardView(row, now),
  lockScreen: row.lockScreen !== 0,
  venue: row.venueLat === null || row.venueLng === null ? null : { lat: row.venueLat, lng: row.venueLng },
})

export const publicVenue = (
  issuer: IssuerRow,
  cards: CardRow[],
  now: number,
  baseUrl: string,
): PublicVenue => ({
  brandColor: issuer.brandColor,
  cards: cards.map((card) => cardView(card, now)),
  handle: issuer.handle,
  logoUrl: logoUrlFor(baseUrl, issuer.handle, issuer.logoPrefix),
  name: issuer.name,
  tagline: issuer.tagline,
})

// The venue page. A card's own link is this plus `/<slug>`.
export const publicUrlFor = (baseUrl: string, handle: string): string =>
  `${baseUrl.replace(/\/$/u, '')}/@${handle}`
