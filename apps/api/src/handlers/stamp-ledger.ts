import { normalizeUid, parseQr, StampAdjustBody, StampRedeemBody } from '@fuda/sdk'
import type { Hex, StampLedger, StampSummary } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { principalKey } from '../auth/principal.ts'
import { members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { notifyPassChanged } from '../pass/notify.ts'
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
    .where(and(eq(members.attestationUid, uid), eq(members.issuerId, issuerId)))
    .get()

const ledgerOf = async (c: Context<AppEnv>, issuerId: string, uid: Hex): Promise<StampLedger | null> => {
  const db = c.get('db')
  const [entries, summary] = await Promise.all([
    readLedger(db, issuerId, uid),
    readStampSummary(db, uid, c.get('now')()),
  ])
  return summary === null ? null : { entries, summary }
}

const respond = async (c: Context<AppEnv>, issuerId: string, uid: Hex, row: AdjustmentRow) => {
  const ledger = await ledgerOf(c, issuerId, uid)
  return ledger === null
    ? errorResponse(c, 'not_found', 404)
    : jsonResponse(c, { ...ledger, entry: entryOf(row) })
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

interface Target {
  body: ActionBody
  issuerId: string
  operatorAddress: string
  requestId: string
  status: 'active' | 'revoked'
  uid: Hex
}

// The venue comes from the session alone; a Right of another venue is as
// unknown as one that does not exist.
const resolveTarget = async (c: Context<AppEnv>, kind: Kind): Promise<Response | Target> => {
  const operator = c.get('operator')
  const { issuerId } = operator
  const raw: unknown = await c.req.json().catch(() => null)
  const body = parseBody(kind, raw)
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  if (body === null) {
    return errorResponse(c, 'bad_input', 400)
  }
  const uid = body.uid === undefined ? parseQr((body.qr ?? '').trim()) : normalizeUid(body.uid)
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  const member = await memberOf(c, issuerId, uid)
  if (member === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  return {
    body,
    issuerId,
    operatorAddress: principalKey(operator.principal),
    requestId: `${issuerId}:${body.requestId.toLowerCase()}`,
    status: member.status,
    uid,
  }
}

const replayOf = async (c: Context<AppEnv>, kind: Kind, target: Target): Promise<Response | null> => {
  const { body, issuerId, requestId, uid } = target
  const previous = await readAdjustment(c.get('db'), requestId)
  if (previous === undefined) {
    return null
  }
  if (
    previous.uid !== uid ||
    previous.kind !== kind ||
    (kind === 'adjust' && previous.delta !== body.delta)
  ) {
    return errorResponse(c, 'bad_input', 409)
  }
  notifyPassChanged(c, uid)
  return await respond(c, issuerId, uid, previous)
}

const refusalFor = async (
  c: Context<AppEnv>,
  kind: Kind,
  target: Target,
): Promise<Refusal | 'not_found' | null> => {
  const summary = await readStampSummary(c.get('db'), target.uid, c.get('now')())
  return summary === null ? 'not_found' : refusalOf(kind, target.body.delta, target.status, summary)
}

const act = async (c: Context<AppEnv>, kind: Kind): Promise<Response> => {
  c.header('cache-control', 'no-store')
  const target = await resolveTarget(c, kind)
  if (target instanceof Response) {
    return target
  }
  const { body, issuerId, operatorAddress, requestId, uid } = target
  const replayed = await replayOf(c, kind, target)
  if (replayed !== null) {
    return replayed
  }
  const refusal = await refusalFor(c, kind, target)
  if (refusal !== null) {
    return errorResponse(c, refusal, refusal === 'not_found' ? 404 : 409)
  }
  const inserted = await insertAdjustment(c.env.DB, {
    at: c.get('now')(),
    delta: body.delta,
    issuerId,
    kind,
    note: body.note,
    operatorAddress,
    requestId,
    uid,
  })
  if (!inserted) {
    // An identical request won the race, or the balance moved between the read
    // above and the guarded insert.
    const raced = await replayOf(c, kind, target)
    return raced ?? errorResponse(c, (await refusalFor(c, kind, target)) ?? 'conflict', 409)
  }
  const row = await readAdjustment(c.get('db'), requestId)
  if (row === undefined) {
    throw new Error('stamp adjustment missing after commit')
  }
  notifyPassChanged(c, uid)
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
  const ledger = await ledgerOf(c, issuerId, uid)
  return ledger === null ? errorResponse(c, 'not_found', 404) : jsonResponse(c, ledger)
})
