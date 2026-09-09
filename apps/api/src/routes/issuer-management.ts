import { CardUpdateBody } from '@fuda/sdk'
import type { IssuerPassStatus } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import * as v from 'valibot'

import { cards, cardStampSettings } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { readIssuerPasses } from '../issuers/passes.ts'
import { operatorCardView } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'

export const issuerManagementRoutes = new Hono<AppEnv>()

const PASS_STATUSES: readonly IssuerPassStatus[] = [
  'active',
  'revoked',
  'expired',
  'not_yet_valid',
  'consumed',
  'unknown',
]

const positiveInteger = (raw: string | undefined, fallback: number): number | null => {
  if (raw === undefined || raw === '') {
    return fallback
  }
  const parsed = Number(raw)
  return /^[1-9]\d*$/u.test(raw) && Number.isSafeInteger(parsed) ? parsed : null
}

issuerManagementRoutes.get('/issuers/me/cards/:cardId', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const card = await c
    .get('db')
    .select()
    .from(cards)
    .where(and(eq(cards.id, c.req.param('cardId')), eq(cards.issuerId, issuerId)))
    .get()
  return card === undefined
    ? errorResponse(c, 'not_found', 404)
    : jsonResponse(c, { card: operatorCardView(card, c.get('now')()) })
})

issuerManagementRoutes.put('/issuers/me/cards/:cardId', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(CardUpdateBody, body)
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const { venue, ...editable } = parsed.output
  const update = c
    .get('db')
    .update(cards)
    .set({
      ...editable,
      lockScreen: editable.lockScreen ? 1 : 0,
      venueLat: venue?.lat ?? null,
      venueLng: venue?.lng ?? null,
    })
    .where(and(eq(cards.id, c.req.param('cardId')), eq(cards.issuerId, issuerId)))
    .returning()
  const [updatedRows] =
    parsed.output.category === 'ticket'
      ? await c.get('db').batch([
          update,
          c
            .get('db')
            .update(cardStampSettings)
            .set({ enabled: false })
            .where(
              and(
                eq(cardStampSettings.cardId, c.req.param('cardId')),
                inArray(
                  cardStampSettings.cardId,
                  c.get('db').select({ id: cards.id }).from(cards).where(eq(cards.issuerId, issuerId)),
                ),
              ),
            ),
        ])
      : await c.get('db').batch([update])
  const [updated] = updatedRows
  return updated === undefined
    ? errorResponse(c, 'not_found', 404)
    : jsonResponse(c, { card: operatorCardView(updated, c.get('now')()) })
})

issuerManagementRoutes.get('/issuers/me/passes', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const page = positiveInteger(c.req.query('page'), 1)
  const pageSize = positiveInteger(c.req.query('pageSize'), 25)
  const q = (c.req.query('q') ?? '').trim()
  const rawCardId = c.req.query('cardId') ?? ''
  const rawStatus = c.req.query('status') ?? ''
  const status = PASS_STATUSES.find((candidate) => candidate === rawStatus) ?? null
  if (
    page === null ||
    pageSize === null ||
    pageSize > 100 ||
    q.length > 120 ||
    (rawStatus !== '' && status === null)
  ) {
    return errorResponse(c, 'bad_input', 400)
  }
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  return jsonResponse(
    c,
    await readIssuerPasses(c.env.DB, issuerId, c.get('now')(), {
      cardId: rawCardId === '' ? null : rawCardId,
      page,
      pageSize,
      q,
      status,
    }),
  )
})
