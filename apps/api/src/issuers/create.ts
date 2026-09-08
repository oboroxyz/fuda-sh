import type { CardRequest, IssuerCreateRequest } from '@fuda/sdk'

import { attachIssuer } from '../auth/session.ts'
import type { OperatorSession } from '../auth/session.ts'
import type { Db } from '../db/client.ts'
import { cards, issuers } from '../db/schema.ts'
import { claimLogoUpload } from '../media/store.ts'

const cardValues = (
  input: CardRequest,
  row: { createdAt: number; id: string; issuerId: string },
): typeof cards.$inferInsert => ({
  category: input.category,
  claimFrom: input.claimFrom,
  claimUntil: input.claimUntil,
  createdAt: row.createdAt,
  id: row.id,
  issuerId: row.issuerId,
  lockScreen: input.lockScreen ? 1 : 0,
  perk: input.perk,
  reward: input.reward,
  slug: input.slug,
  title: input.title,
  validFrom: input.validFrom,
  validUntil: input.validUntil,
  validityDays: input.validityDays,
  venueLat: input.venue?.lat ?? null,
  venueLng: input.venue?.lng ?? null,
})

export const insertCard = async (
  db: Db,
  issuerId: string,
  input: CardRequest,
  now: number,
): Promise<typeof cards.$inferSelect | null> => {
  const id = crypto.randomUUID()
  try {
    const [created] = await db
      .insert(cards)
      .values(cardValues(input, { createdAt: now, id, issuerId }))
      .returning()
    return created ?? null
  } catch {
    return null
  }
}

export const insertIssuerAndCard = async (
  db: Db,
  operator: OperatorSession,
  input: IssuerCreateRequest,
  now: number,
): Promise<{ cardId: string; issuerId: string }> => {
  const issuerId = crypto.randomUUID()
  const cardId = crypto.randomUUID()
  // A logo staged before the venue existed is claimed here; an id that is
  // unknown, spent or someone else's simply leaves the venue unbranded rather
  // than failing a create the operator cannot retry.
  const logoPrefix =
    input.logoUploadId === null
      ? null
      : await claimLogoUpload(db, { id: input.logoUploadId, now, sessionTokenHash: operator.tokenHash })
  await db.batch([
    db.insert(issuers).values({
      brandColor: input.brandColor,
      createdAt: now,
      handle: input.handle,
      id: issuerId,
      logoPrefix,
      name: input.name,
      operatorAddress: operator.address,
      tagline: input.tagline,
    }),
    db.insert(cards).values(cardValues(input.card, { createdAt: now, id: cardId, issuerId })),
    attachIssuer(db, operator.tokenHash, issuerId),
  ])
  return { cardId, issuerId }
}
