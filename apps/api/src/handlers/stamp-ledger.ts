import { normalizeUid, parseQr, StampAdjustBody, StampRedeemBody } from '@fuda/sdk'
import type { Hex, StampSummary } from '@fuda/sdk'
import { and, eq, ne } from 'drizzle-orm'
import type { Context } from 'hono'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { scheduleStampPassUpdate } from '../pass/stamp-update.ts'
import { entryOf, insertAdjustment, readAdjustment, readLedger } from '../stamps/adjustment-store.ts'
import type { AdjustmentRow } from '../stamps/adjustment-store.ts'
import { readStampSummary } from '../stamps/store.ts'

type Kind = 'adjust' | 'redeem'
type Refusal = 'below_zero' | 'not_full' | 'revoked' | 'stamps_disabled'

const refusalOf = (
  kind: Kind,
  delta: number,
  status: 'active' | 'revoked',
  summary: StampSummary,
): Refusal | null => {
  if (status === 'revoked') {
    return 'revoked'
  }
  if (!summary.enabled) {
    return 'stamps_disabled'
  }
  if (kind === 'redeem') {
    return summary.total < summary.goal ? 'not_full' : null
  }
  return summary.total + delta < 0 ? 'below_zero' : null
}

const memberOf = async (c: Context<AppEnv>, issuerId: string, uid: Hex) =>
  await c
    .get('db')
    .select({ status: members.status })
    .from(members)
    .where(and(eq(members.attestationUid, uid), eq(members.issuerId, issuerId), ne(members.level, 'private')))
    .get()

const respond = async (c: Context<AppEnv>, issuerId: string, uid: Hex, row: AdjustmentRow) => {
  const db = c.get('db')
  const [entries, summary] = await Promise.all([
    readLedger(db, issuerId, uid),
    readStampSummary(db, uid, c.get('now')()),
  ])
  return jsonResponse(c, { entries, entry: entryOf(row), summary })
}

interface ActionBody {
  delta: number
  note: string
  qr?: string | undefined
  requestId: string
  uid?: string | undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the parse step for the request body
const parseBody = (kind: Kind, body: unknown): ActionBody | null => {
  if (kind === 'redeem') {
    const parsed = v.safeParse(StampRedeemBody, body)
    return parsed.success ? { ...parsed.output, delta: 0, note: '' } : null
  }
  const parsed = v.safeParse(StampAdjustBody, body)
  return parsed.success ? parsed.output : null
}

const targetUid = (body: { qr?: string | undefined; uid?: string | undefined }): Hex | null =>
  body.uid === undefined ? parseQr((body.qr ?? '').trim()) : normalizeUid(body.uid)

const act = async (c: Context<AppEnv>, kind: Kind): Promise<Response> => {
  c.header('cache-control', 'no-store')
  const operator = c.get('operator')
  const { issuerId } = operator
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const input = parseBody(kind, body)
  if (input === null) {
    return errorResponse(c, 'bad_input', 400)
  }
  const uid = targetUid(input)
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  const { delta, note } = input
  const member = await memberOf(c, issuerId, uid)
  if (member === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const db = c.get('db')
  const requestId = `${issuerId}:${input.requestId.toLowerCase()}`
  const replay = async (): Promise<Response | null> => {
    const previous = await readAdjustment(db, requestId)
    if (previous === undefined) {
      return null
    }
    if (previous.uid !== uid || previous.kind !== kind || (kind === 'adjust' && previous.delta !== delta)) {
      return errorResponse(c, 'bad_input', 409)
    }
    scheduleStampPassUpdate(c, uid)
    return await respond(c, issuerId, uid, previous)
  }
  const replayed = await replay()
  if (replayed !== null) {
    return replayed
  }
  const now = c.get('now')()
  const before = await readStampSummary(db, uid, now)
  if (before === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const refusal = refusalOf(kind, delta, member.status, before)
  if (refusal !== null) {
    return errorResponse(c, refusal, 409)
  }
  const inserted = await insertAdjustment(c.env.DB, {
    at: now,
    delta,
    issuerId,
    kind,
    note,
    operatorAddress: operator.address,
    requestId,
    uid,
  })
  if (!inserted) {
    // Either an identical request won the race, or the balance moved between
    // the read above and the guarded insert.
    const raced = await replay()
    if (raced !== null) {
      return raced
    }
    const after = await readStampSummary(db, uid, now)
    const lost = after === null ? null : refusalOf(kind, delta, member.status, after)
    return errorResponse(c, lost ?? 'conflict', 409)
  }
  const row = await readAdjustment(db, requestId)
  if (row === undefined) {
    throw new Error('stamp adjustment missing after commit')
  }
  scheduleStampPassUpdate(c, uid)
  return await respond(c, issuerId, uid, row)
}

export const postV1IssuersMeStampsRedeem = defineHandler(operatorAuth(), async (c) => await act(c, 'redeem'))

export const postV1IssuersMeStampsAdjust = defineHandler(operatorAuth(), async (c) => await act(c, 'adjust'))

export const getV1IssuersMeStampsUid = defineHandler(operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const { issuerId } = c.get('operator')
  const uid = normalizeUid(c.req.param().uid)
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  if (issuerId === null || (await memberOf(c, issuerId, uid)) === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const db = c.get('db')
  const [entries, summary] = await Promise.all([
    readLedger(db, issuerId, uid),
    readStampSummary(db, uid, c.get('now')()),
  ])
  return summary === null ? errorResponse(c, 'not_found', 404) : jsonResponse(c, { entries, summary })
})
