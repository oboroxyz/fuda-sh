import { isLogoPrefix, LOGO_VARIANTS, objectKey } from './logo.ts'

const ROWS_PER_BATCH = 80
const MAX_BATCHES_PER_RUN = 10
const RUN_BUDGET_MS = 20_000

export const purgeExpiredLogos = async (
  database: D1Database,
  bucket: R2Bucket,
  now: number,
): Promise<number> => {
  const deadline = Date.now() + RUN_BUDGET_MS
  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN && Date.now() < deadline; batch += 1) {
    // Claim before touching R2. Pending uploads become unspendable atomically
    // with the reference check. Keep the row until R2 succeeds so failures retry.
    // oxlint-disable-next-line no-await-in-loop -- each bounded batch must finish before claiming another
    const rows = await database
      .prepare(`UPDATE logo_uploads SET status = 'committed'
      WHERE id IN (
        SELECT id FROM logo_uploads WHERE expires_at <= ?1
          AND NOT EXISTS (SELECT 1 FROM issuers WHERE logo_prefix = asset_prefix)
        ORDER BY expires_at LIMIT ?2
      ) RETURNING id, asset_prefix`)
      .bind(now, ROWS_PER_BATCH)
      .all<{ id: string; asset_prefix: string }>()
    if (rows.results.length === 0) {
      break
    }
    // oxlint-disable-next-line no-await-in-loop -- retain failed deletions for the next scheduled run
    const removed = await Promise.all(
      rows.results.map(async (row) => {
        if (!isLogoPrefix(row.asset_prefix)) {
          return 0
        }
        await bucket.delete(LOGO_VARIANTS.map((variant) => objectKey(row.asset_prefix, variant)))
        await database.prepare('DELETE FROM logo_uploads WHERE id = ?1').bind(row.id).run()
        return 1
      }),
    )
    deleted += removed.reduce<number>((total, count) => total + count, 0)
  }
  return deleted
}
