import { normalizeUid, parseQr, ReceptionBody, StampSettingsBody, USAGE_MODEL } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { members } from '../db/schema.ts'
import { ownedCard } from '../issuers/owned-card.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { scheduleStampPassUpdate } from '../pass/stamp-update.ts'
import { readReception, recordReception } from '../stamps/reception-store.ts'
import { readStampSettings, readStampSummary } from '../stamps/store.ts'
import { notifyAdmission } from '../verify/admit.ts'
import { qrOutcome } from '../verify/qr-admission.ts'
import { resolveVerdict, verdictBody, waitUntilOf } from './verify.ts'

export const getV1IssuersMeCardsCardIdStamps = defineHandler(operatorAuth(), async (c) => {
  const card = await ownedCard(c, c.req.param().cardId)
  if (card === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  c.header('cache-control', 'no-store')
  return jsonResponse(c, await readStampSettings(c.get('db'), card.id))
})

export const putV1IssuersMeCardsCardIdStamps = defineHandler(operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const card = await ownedCard(c, c.req.param().cardId)
  if (card === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  // A card's identity never changes, so unlike its category this needs no predicate in the write.
  if (card.category !== 'membership' || card.identity === 'sensitive') {
    return errorResponse(c, 'stamps_not_supported', 409)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(StampSettingsBody, body)
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  // The ownership and category predicate belongs to this write. A preliminary
  // lookup alone would let an overlapping Card edit turn the Card into a Ticket
  // before this upsert and then have this request silently re-enable Stamps.
  const saved = await c.env.DB.prepare(
    `INSERT INTO card_stamp_settings (card_id, daily_limit, enabled, goal)
     SELECT id, ?1, ?2, ?3
     FROM cards
     WHERE id = ?4 AND issuer_id = ?5 AND category = 'membership'
     ON CONFLICT(card_id) DO UPDATE SET
       daily_limit = excluded.daily_limit,
       enabled = excluded.enabled,
       goal = excluded.goal
     RETURNING card_id AS cardId`,
  )
    .bind(parsed.output.dailyLimit, parsed.output.enabled ? 1 : 0, parsed.output.goal, card.id, card.issuerId)
    .first<{ cardId: string }>()
  if (saved === null) {
    return errorResponse(c, 'stamps_not_supported', 409)
  }
  return jsonResponse(c, parsed.output)
})

export const getV1StampsUid = defineHandler(async (c) => {
  const uid = normalizeUid(c.req.param().uid)
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  c.header('cache-control', 'no-store')
  const summary = await readStampSummary(c.get('db'), uid, c.get('now')())
  return summary === null ? errorResponse(c, 'not_found', 404) : jsonResponse(c, summary)
})

export const postV1IssuersMeReception = defineHandler(operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const operator = c.get('operator')
  const { issuerId } = operator
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(ReceptionBody, body)
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const uid = parseQr(parsed.output.qr.trim())
  if (uid === null) {
    return errorResponse(c, 'bad_qr', 400)
  }
  const db = c.get('db')
  const member = await db
    .select()
    .from(members)
    .where(and(eq(members.attestationUid, uid), eq(members.issuerId, issuerId)))
    .get()
  if (member === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const id = `${issuerId}:${parsed.output.requestId.toLowerCase()}`
  const previous = await readReception(db, id)
  if (previous !== undefined) {
    if (previous.uid !== uid) {
      return errorResponse(c, 'bad_input', 409)
    }
    if (previous.response.decision === 'ADMIT') {
      scheduleStampPassUpdate(c, uid)
    }
    return jsonResponse(c, previous.response)
  }
  const now = c.get('now')()
  const resolved = await resolveVerdict(c, uid, now)
  if (!resolved.ok) {
    return resolved.res
  }
  const out = qrOutcome(resolved.out)
  const { inserted, receipt } = await recordReception(c.env.DB, db, {
    id,
    issuerId,
    now,
    operatorAddress: operator.address,
    singleUse: out.decision === 'ADMIT' && out.canonical.usageModel === USAGE_MODEL.SINGLE_USE,
    uid,
    verdict: verdictBody(out),
  })
  if (receipt.uid !== uid) {
    return errorResponse(c, 'bad_input', 409)
  }
  if (receipt.response.decision === 'ADMIT') {
    if (inserted && out.decision === 'ADMIT') {
      notifyAdmission(
        {
          canonical: out.canonical,
          db,
          now,
          onAdmit: c.get('onAdmit'),
          path: 'qr',
          uid,
          waitUntil: waitUntilOf(c),
        },
        receipt.entryLogId,
      )
    }
    scheduleStampPassUpdate(c, uid)
  }
  return jsonResponse(c, receipt.response)
})
