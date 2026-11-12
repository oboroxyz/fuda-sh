import { IMAGE_SETS } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { defineHandler } from 'void'

import { cards } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { ownedCard } from '../issuers/owned-card.ts'
import { operatorCardView } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { IMMUTABLE_CACHE_CONTROL } from '../media/logo.ts'
import { readImageObject, storeImageSet } from '../media/store.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { notifyPassesChanged } from '../pass/notify.ts'
import { requirementsOf } from '../requirements/store.ts'
import { partsOf } from './media.ts'

const CARD_IMAGES = {
  artwork: { field: 'artworkPrefix', spec: IMAGE_SETS.artwork },
  poster: { field: 'posterPrefix', spec: IMAGE_SETS.poster },
} as const
type CardImageKind = keyof typeof CARD_IMAGES

// Points the Card at a set, or at none, and answers the updated Card. Ownership
// is checked first, so nothing reaches R2 for a Card that is not the operator's.
const setCardImage = async (
  c: Context<AppEnv>,
  card: typeof cards.$inferSelect,
  kind: CardImageKind,
  prefix: string | null,
): Promise<Response> => {
  const db = c.get('db')
  const change = { [CARD_IMAGES[kind].field]: prefix }
  await db.update(cards).set(change).where(eq(cards.id, card.id))
  const updated = { ...card, ...change }
  const requirements = await requirementsOf(db, updated)
  notifyPassesChanged(c, { cardId: card.id })
  return jsonResponse(c, {
    card: operatorCardView(updated, c.get('now')(), requirements, c.env.API_BASE_URL),
  })
}

// Both methods share the operator's Card lookup; `choose` names the set to select, null
// for none, or answers on its own when the upload cannot be stored.
const cardImageRoute = (
  kind: CardImageKind,
  choose: (c: Context<AppEnv>) => Promise<string | null | Response>,
) =>
  defineHandler(operatorAuth(), async (c) => {
    c.header('cache-control', 'no-store')
    const card = await ownedCard(c, c.req.param().cardId)
    if (card === undefined) {
      return errorResponse(c, 'not_found', 404)
    }
    const chosen = await choose(c)
    return chosen instanceof Response ? chosen : await setCardImage(c, card, kind, chosen)
  })

const putCardImage = (kind: CardImageKind) =>
  cardImageRoute(kind, async (c) => {
    const bucket = c.env.MEDIA_BUCKET
    if (bucket === undefined) {
      return errorResponse(c, 'media_not_configured', 501)
    }
    const { spec } = CARD_IMAGES[kind]
    const parts = await partsOf(c.req.raw, spec)
    const stored = parts === null ? null : await storeImageSet(bucket, parts, spec)
    return stored === null || !stored.ok ? errorResponse(c, 'bad_upload', 400) : stored.prefix
  })
const deleteCardImage = (kind: CardImageKind) => cardImageRoute(kind, async () => await Promise.resolve(null))

export const putCardArtwork = putCardImage('artwork')
export const deleteCardArtwork = deleteCardImage('artwork')
export const putCardPoster = putCardImage('poster')
export const deleteCardPoster = deleteCardImage('poster')

const getCardImage = (kind: CardImageKind) =>
  defineHandler(async (c) => {
    const { id, variant } = c.req.param()
    const { spec, field } = CARD_IMAGES[kind]
    const bucket = c.env.MEDIA_BUCKET
    if (
      bucket === undefined ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id) ||
      !Object.hasOwn(spec.variants, variant)
    ) {
      return errorResponse(c, 'not_found', 404)
    }
    const prefix = `${spec.prefix}/${id}`
    const card = await c.get('db').select({ id: cards.id }).from(cards).where(eq(cards[field], prefix)).get()
    if (card === undefined) {
      return errorResponse(c, 'not_found', 404)
    }
    const object = await readImageObject(bucket, prefix, variant, spec)
    if (object === null) {
      return errorResponse(c, 'not_found', 404)
    }
    const headers = { 'cache-control': IMMUTABLE_CACHE_CONTROL, etag: object.etag }
    return c.req.header('if-none-match') === object.etag
      ? new Response(null, { headers, status: 304 })
      : new Response(object.body, { headers: { ...headers, 'content-type': 'image/png' } })
  })

export const getArtwork = getCardImage('artwork')
export const getPoster = getCardImage('poster')
