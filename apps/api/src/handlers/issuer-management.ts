import { asHex, CardIntegrationsBody, CardUpdateBody } from '@fuda/sdk'
import type { IssuerPassStatus } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { badgesByUid, withBadges } from '../badges/advisory.ts'
import { cards, cardStampSettings } from '../db/schema.ts'
import { readCardIntegrations, writeCardIntegrations } from '../integrations/store.ts'
import { ownedCard } from '../issuers/owned-card.ts'
import { readIssuerPasses } from '../issuers/passes.ts'
import { operatorCardView } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'

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

export const getV1IssuersMeCardsCardId = defineHandler(operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const card = await ownedCard(c, c.req.param().cardId)
  return card === undefined
    ? errorResponse(c, 'not_found', 404)
    : jsonResponse(c, { card: operatorCardView(card, c.get('now')()) })
})

export const putV1IssuersMeCardsCardId = defineHandler(operatorAuth(), async (c) => {
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
  const { attendance, venue, ...editable } = parsed.output
  if (attendance !== undefined) {
    // Refused on an off-chain card, and a card that is not the operator's reads
    // as missing, so this lookup does not reveal which cards exist.
    const current = await ownedCard(c, c.req.param().cardId)
    if (current === undefined) {
      return errorResponse(c, 'not_found', 404)
    }
    if (current.record !== 'onchain') {
      return errorResponse(c, 'bad_input', 400)
    }
  }
  const changes: Partial<typeof cards.$inferInsert> = {
    ...editable,
    lockScreen: editable.lockScreen ? 1 : 0,
    venueLat: venue?.lat ?? null,
    venueLng: venue?.lng ?? null,
  }
  if (attendance !== undefined) {
    changes.attendance = attendance ? 1 : 0
  }
  const update = c
    .get('db')
    .update(cards)
    .set(changes)
    .where(and(eq(cards.id, c.req.param().cardId), eq(cards.issuerId, issuerId)))
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
                eq(cardStampSettings.cardId, c.req.param().cardId),
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

// docs/specs/pass-types-and-flows.md#card-integrations — a Card's optional
// services, saved apart from the Card itself so a new integration is a new key
// here, never a change to the Card contract.
export const getV1IssuersMeCardsCardIdIntegrations = defineHandler(operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const card = await ownedCard(c, c.req.param().cardId)
  return card === undefined
    ? errorResponse(c, 'not_found', 404)
    : jsonResponse(c, await readCardIntegrations(c.get('db'), card.id))
})

export const putV1IssuersMeCardsCardIdIntegrations = defineHandler(operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const parsed = v.safeParse(CardIntegrationsBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  // A human Badge's nullifier is the same at every venue, which is the link this setting removes.
  const card = await ownedCard(c, c.req.param().cardId)
  if (card?.identity === 'sensitive') {
    return errorResponse(c, 'integrations_not_supported', 409)
  }
  const saved = await writeCardIntegrations(
    c.env.DB,
    c.get('db'),
    c.req.param().cardId,
    issuerId,
    parsed.output,
  )
  return saved === null ? errorResponse(c, 'not_found', 404) : jsonResponse(c, saved)
})

export const getV1IssuersMePasses = defineHandler(operatorAuth(), async (c) => {
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
  const listed = await readIssuerPasses(c.env.DB, issuerId, c.get('now')(), {
    cardId: rawCardId === '' ? null : rawCardId,
    page,
    pageSize,
    q,
    source: null,
    status,
  })
  // One badge read for the page, so the operator's own list shows the same fact
  // of a Badge that /members carries. A uid that fails validation is malformed
  // and is left out of the read rather than reported.
  const held = await badgesByUid(
    c.get('db'),
    listed.passes.flatMap((pass) => {
      const uid = asHex(pass.uid, 32)
      return uid === null ? [] : [uid]
    }),
  )
  return jsonResponse(c, { ...listed, passes: withBadges(listed.passes, held) })
})
