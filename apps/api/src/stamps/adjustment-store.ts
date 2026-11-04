import type { Hex, StampLedgerEntry } from '@fuda/sdk'
import { desc, eq, and } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { stampAdjustments } from '../db/schema.ts'

export const LEDGER_PAGE = 10

export type AdjustmentRow = typeof stampAdjustments.$inferSelect

export const readAdjustment = async (db: Db, requestId: string): Promise<AdjustmentRow | undefined> =>
  await db.select().from(stampAdjustments).where(eq(stampAdjustments.requestId, requestId)).get()

export const entryOf = (row: AdjustmentRow): StampLedgerEntry => ({
  at: row.at,
  delta: row.delta,
  kind: row.kind,
  note: row.note,
})

export const readLedger = async (db: Db, issuerId: string, uid: Hex): Promise<StampLedgerEntry[]> => {
  const rows = await db
    .select()
    .from(stampAdjustments)
    .where(and(eq(stampAdjustments.issuerId, issuerId), eq(stampAdjustments.uid, uid)))
    .orderBy(desc(stampAdjustments.id))
    .limit(LEDGER_PAGE)
  return rows.map(entryOf)
}

interface AdjustmentInput {
  at: number
  delta: number
  issuerId: string
  kind: 'adjust' | 'redeem'
  note: string
  operatorAddress: string
  requestId: string
  uid: Hex
}

// The balance rule and the insert are one statement, and D1 runs a statement
// alone, so two requests cannot both pass the check against the same total. A
// redemption takes the goal of the pass's Card; the delta argument only
// matters for an adjustment. A repeated request id inserts nothing.
export const insertAdjustment = async (binding: D1Database, input: AdjustmentInput): Promise<boolean> => {
  const total = `(
    (SELECT COUNT(*) FROM stamp_credits WHERE issuer_id = ?1 AND uid = ?2)
    + (SELECT COALESCE(SUM(delta), 0) FROM stamp_adjustments WHERE issuer_id = ?1 AND uid = ?2)
  )`
  const result = await binding
    .prepare(`
      INSERT INTO stamp_adjustments (issuer_id, uid, kind, delta, note, operator_address, request_id, at)
      SELECT ?1, ?2, ?3, CASE WHEN ?3 = 'redeem' THEN -COALESCE(s.goal, 10) ELSE ?4 END, ?5, ?6, ?7, ?8
      FROM members m
      LEFT JOIN cards c ON c.id = m.card_id AND c.issuer_id = ?1
      LEFT JOIN card_stamp_settings s ON s.card_id = c.id
      WHERE m.attestation_uid = ?2 AND m.issuer_id = ?1 AND m.status = 'active' AND m.level != 'private'
        AND COALESCE(s.enabled, 0) = 1
        AND CASE WHEN ?3 = 'redeem' THEN ${total} >= COALESCE(s.goal, 10) ELSE ${total} + ?4 >= 0 END
      ON CONFLICT (request_id) DO NOTHING
    `)
    .bind(
      input.issuerId,
      input.uid,
      input.kind,
      input.delta,
      input.note,
      input.operatorAddress,
      input.requestId,
      input.at,
    )
    .run()
  return (result.meta.changes ?? 0) > 0
}
