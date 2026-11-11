import { IMAGE_SETS } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { defineHandler } from 'void'

import { cards } from '../db/schema.ts'
import { ownedCard } from '../issuers/owned-card.ts'
import { operatorCardView } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { IMMUTABLE_CACHE_CONTROL } from '../media/logo.ts'
import { readImageObject, storeImageSet } from '../media/store.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { notifyPassesChanged } from '../pass/notify.ts'
import { requirementsOf } from '../requirements/store.ts'
import { partsOf } from './media.ts'

const changeCardArtwork = defineHandler(operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const current = await ownedCard(c, c.req.param().cardId)
  if (current === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  let artworkPrefix: string | null = null
  if (c.req.method === 'PUT') {
    const bucket = c.env.MEDIA_BUCKET
    if (bucket === undefined) {
      return errorResponse(c, 'media_not_configured', 501)
    }
    const parts = await partsOf(c.req.raw, IMAGE_SETS.artwork)
    if (parts === null) {
      return errorResponse(c, 'bad_upload', 400)
    }
    const stored = await storeImageSet(bucket, parts, IMAGE_SETS.artwork)
    if (!stored.ok) {
      return errorResponse(c, 'bad_upload', 400)
    }
    artworkPrefix = stored.prefix
  }
  const db = c.get('db')
  await db.update(cards).set({ artworkPrefix }).where(eq(cards.id, current.id))
  const updatedCard = { ...current, artworkPrefix }
  const requirements = await requirementsOf(db, updatedCard)
  const card = operatorCardView(updatedCard, c.get('now')(), requirements, c.env.API_BASE_URL)
  notifyPassesChanged(c, { cardId: current.id })
  return jsonResponse(c, { card })
})

export const putCardArtwork = defineHandler(async (c) => await changeCardArtwork(c))
export const deleteCardArtwork = defineHandler(async (c) => await changeCardArtwork(c))

export const getArtwork = defineHandler(async (c) => {
  const { id, variant } = c.req.param()
  const bucket = c.env.MEDIA_BUCKET
  if (
    bucket === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id) ||
    !Object.hasOwn(IMAGE_SETS.artwork.variants, variant)
  ) {
    return errorResponse(c, 'not_found', 404)
  }
  const prefix = `artwork/${id}`
  const card = await c
    .get('db')
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.artworkPrefix, prefix))
    .get()
  if (card === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const object = await readImageObject(bucket, prefix, variant, IMAGE_SETS.artwork)
  if (object === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const headers = { 'cache-control': IMMUTABLE_CACHE_CONTROL, etag: object.etag }
  return c.req.header('if-none-match') === object.etag
    ? new Response(null, { headers, status: 304 })
    : new Response(object.body, { headers: { ...headers, 'content-type': 'image/png' } })
})
