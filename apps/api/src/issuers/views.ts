import type { CardView, IssuerView, PublicVenue } from '@fuda/sdk'
import type { Hex } from 'viem'

import type { cards, issuers } from '../db/schema.ts'

type IssuerRow = typeof issuers.$inferSelect
type CardRow = typeof cards.$inferSelect

export const issuerView = (row: IssuerRow): IssuerView => {
  // Annotated (not cast): written only from ADDRESS_RE-validated input.
  const operatorAddress: Hex = `0x${row.operatorAddress.slice(2)}`
  return {
    brandColor: row.brandColor,
    createdAt: row.createdAt,
    handle: row.handle,
    id: row.id,
    name: row.name,
    operatorAddress,
    tagline: row.tagline,
  }
}

export const cardView = (row: CardRow): CardView => ({
  category: row.category,
  id: row.id,
  perk: row.perk,
  reward: row.reward,
  slug: row.slug,
  title: row.title,
  validityDays: row.validityDays,
})

export const publicVenue = (issuer: IssuerRow, cards: CardRow[]): PublicVenue => ({
  brandColor: issuer.brandColor,
  cards: cards.map(cardView),
  handle: issuer.handle,
  name: issuer.name,
  tagline: issuer.tagline,
})

// The venue page. A card's own link is this plus `/<slug>`.
export const publicUrlFor = (baseUrl: string, handle: string): string =>
  `${baseUrl.replace(/\/$/u, '')}/@${handle}`

export const cardUrlFor = (baseUrl: string, handle: string, slug: string): string =>
  `${publicUrlFor(baseUrl, handle)}/${slug}`
