import { defineScheduled } from 'void'

export const SENSITIVE_ENTRY_RETENTION_SECONDS = 30 * 86_400
const ROWS_PER_BATCH = 80
const MAX_BATCHES_PER_RUN = 10
const RUN_BUDGET_MS = 20_000

const EXPIRED_ENTRIES = `
  SELECT e.id FROM cards c
  JOIN members m ON m.card_id = c.id
  JOIN entry_log e ON e.uid = m.attestation_uid
  WHERE c.identity = 'sensitive' AND e.at < ?1
    AND NOT EXISTS (SELECT 1 FROM stamp_credits s WHERE s.entry_log_id = e.id)
  ORDER BY e.at, e.id LIMIT ?2
`

export const purgeSensitiveEntries = async (database: D1Database, now: number): Promise<number> => {
  const deadline = Date.now() + RUN_BUDGET_MS
  const cutoff = now - SENSITIVE_ENTRY_RETENTION_SECONDS
  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN && Date.now() < deadline; batch += 1) {
    // The selection stays the same inside this transaction. Receipts copy the verdict and must go with its log.
    // oxlint-disable-next-line no-await-in-loop -- commit each bounded batch before starting another; every statement binds only cutoff and limit
    const [, entries, nonces] = await database.batch([
      database
        .prepare(`DELETE FROM reception_requests WHERE entry_log_id IN (${EXPIRED_ENTRIES})`)
        .bind(cutoff, ROWS_PER_BATCH),
      database.prepare(`DELETE FROM entry_log WHERE id IN (${EXPIRED_ENTRIES})`).bind(cutoff, ROWS_PER_BATCH),
      database
        .prepare(`
        DELETE FROM challenges WHERE nonce IN (
          SELECT n.nonce FROM challenges n
          JOIN members m ON m.attestation_uid = n.uid
          JOIN cards c ON c.id = m.card_id
          WHERE c.identity = 'sensitive' AND n.created_at < ?1
          ORDER BY n.created_at, n.nonce LIMIT ?2
        )
      `)
        .bind(cutoff, ROWS_PER_BATCH),
    ])
    deleted += entries.meta.changes
    if (entries.meta.changes === 0 && nonces.meta.changes === 0) {
      break
    }
  }
  return deleted
}

export const sensitiveEntryLogsJob = defineScheduled(async (controller, env) => {
  await purgeSensitiveEntries(env.DB, Math.floor(controller.scheduledTime / 1000))
})
