import type { CardView, IssuerView, PublicCard } from '@fuda/sdk'
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
  title: row.title,
  validityDays: row.validityDays,
})

export const publicCard = (issuer: IssuerRow, card: CardRow): PublicCard => ({
  brandColor: issuer.brandColor,
  card: cardView(card),
  handle: issuer.handle,
  name: issuer.name,
  tagline: issuer.tagline,
})

export const publicUrlFor = (baseUrl: string, handle: string): string =>
  `${baseUrl.replace(/\/$/u, '')}/@${handle}`
