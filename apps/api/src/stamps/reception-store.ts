import type { Hex, VerifyResponse } from '@fuda/sdk'
import { eq } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { receptionRequests } from '../db/schema.ts'
import { japanDay } from './store.ts'

export const readReception = async (db: Db, id: string) =>
  await db.select().from(receptionRequests).where(eq(receptionRequests.id, id)).get()

interface ReceptionInput {
  id: string
  issuerId: string
  uid: Hex
  now: number
  operatorAddress: string
  singleUse: boolean
  verdict: VerifyResponse
}

// D1 batch is a transaction. Evaluate the daily cap and SINGLE_USE slot inside
// it. A stored request makes each mutation a no-op on retry. The unique Entry
// reception_id also protects simultaneous retries. Each statement binds <100
// values regardless of the configured daily limit.
export const recordReception = async (binding: D1Database, db: Db, input: ReceptionInput) => {
  const { id, issuerId, uid, now, operatorAddress, singleUse, verdict } = input
  const day = japanDay(now)
  const results = await binding.batch([
    binding
      .prepare(`
      INSERT INTO entry_log (uid, at, path, decision, reason, reception_id)
      SELECT ?1, ?2, 'qr',
        CASE WHEN ?4 = 'ADMIT' AND ?6 = 1 AND EXISTS (SELECT 1 FROM slots WHERE uid = ?1 AND slot = 'default')
          THEN 'REJECT' ELSE ?4 END,
        CASE WHEN ?4 = 'ADMIT' AND ?6 = 1 AND EXISTS (SELECT 1 FROM slots WHERE uid = ?1 AND slot = 'default')
          THEN 'ALREADY_USED' ELSE ?5 END, ?3
      WHERE NOT EXISTS (SELECT 1 FROM reception_requests WHERE id = ?3)
      ON CONFLICT (reception_id) DO NOTHING
    `)
      .bind(uid, now, id, verdict.decision, verdict.reason, singleUse ? 1 : 0),
    binding
      .prepare(`
      INSERT INTO slots (uid, slot, consumed_at)
      SELECT uid, 'default', at FROM entry_log
      WHERE reception_id = ?1 AND decision = 'ADMIT' AND ?2 = 1
        AND NOT EXISTS (SELECT 1 FROM reception_requests WHERE id = ?1)
      ON CONFLICT (uid, slot) DO NOTHING
    `)
      .bind(id, singleUse ? 1 : 0),
    binding
      .prepare(`
      INSERT INTO stamp_credits (issuer_id, uid, day, ordinal, at, operator_address, entry_log_id)
      SELECT ?1, e.uid, ?3,
        (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM stamp_credits WHERE issuer_id = ?1 AND uid = e.uid AND day = ?3),
        ?4, ?5, e.id FROM entry_log e
      LEFT JOIN members m ON m.attestation_uid = e.uid AND m.issuer_id = ?1
      LEFT JOIN cards c ON c.id = m.card_id AND c.issuer_id = ?1
      LEFT JOIN card_stamp_settings s ON s.card_id = c.id
      WHERE e.reception_id = ?2 AND e.decision = 'ADMIT'
        AND NOT EXISTS (SELECT 1 FROM reception_requests WHERE id = ?2)
        AND COALESCE(s.enabled, 0) = 1
        AND (SELECT COUNT(*) FROM stamp_credits WHERE issuer_id = ?1 AND uid = e.uid AND day = ?3)
          < COALESCE(s.daily_limit, 1)
      ON CONFLICT (entry_log_id) DO NOTHING
    `)
      .bind(issuerId, id, day, now, operatorAddress),
    binding
      .prepare(`
      INSERT INTO reception_requests (id, issuer_id, uid, entry_log_id, response)
      SELECT ?1, ?2, e.uid, e.id,
        json_set(json(?3), '$.uid', e.uid, '$.decision', e.decision, '$.reason', e.reason,
          '$.stamp', json_object(
            'status', CASE
              WHEN e.decision = 'REJECT' THEN 'not_admitted'
              WHEN EXISTS (SELECT 1 FROM stamp_credits WHERE entry_log_id = e.id) THEN 'awarded'
              WHEN COALESCE(s.enabled, 0) = 0 THEN 'disabled'
              ELSE 'daily_limit' END,
            'summary', CASE WHEN ?5 = 1 THEN NULL ELSE json_object(
              'enabled', json(CASE WHEN COALESCE(s.enabled, 0) = 1 THEN 'true' ELSE 'false' END),
              'dailyLimit', COALESCE(s.daily_limit, 1),
              'goal', COALESCE(s.goal, 10),
              'total', (SELECT COUNT(*) FROM stamp_credits WHERE issuer_id = ?2 AND uid = e.uid),
              'today', (SELECT COUNT(*) FROM stamp_credits WHERE issuer_id = ?2 AND uid = e.uid AND day = ?4)
            ) END))
      FROM entry_log e
      LEFT JOIN members m ON m.attestation_uid = e.uid AND m.issuer_id = ?2
      LEFT JOIN cards c ON c.id = m.card_id AND c.issuer_id = ?2
      LEFT JOIN card_stamp_settings s ON s.card_id = c.id
      WHERE e.reception_id = ?1
      ON CONFLICT (id) DO NOTHING
    `)
      .bind(id, issuerId, JSON.stringify(verdict), day, verdict.entitlement?.level === 2 ? 1 : 0),
  ])
  const receipt = await readReception(db, id)
  if (receipt === undefined) {
    throw new Error('reception receipt missing after commit')
  }
  return { inserted: (results[0]?.meta.changes ?? 0) > 0, receipt }
}
