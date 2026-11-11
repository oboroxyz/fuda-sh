import { defineScheduled } from 'void'

import { purgeExpiredLogos } from '../media/expired-logos.ts'

const ROWS_PER_BATCH = 80
const MAX_BATCHES_PER_RUN = 10
const RUN_BUDGET_MS = 20_000
const TOKEN_RETENTION_SECONDS = 86_400

export const purgeExpiredAuthRows = async (database: D1Database, now: number): Promise<number> => {
  const deadline = Date.now() + RUN_BUDGET_MS
  const tokenCutoff = now - TOKEN_RETENTION_SECONDS
  const statements = [
    database
      .prepare(`DELETE FROM passkey_challenges WHERE challenge IN (
        SELECT challenge FROM passkey_challenges WHERE created_at <= ?1 ORDER BY created_at LIMIT ?2
      )`)
      .bind(now - 300, ROWS_PER_BATCH),
    database
      .prepare(`DELETE FROM sessions WHERE token_hash IN (
        SELECT token_hash FROM sessions WHERE expires_at <= ?1 ORDER BY expires_at LIMIT ?2
      )`)
      .bind(now, ROWS_PER_BATCH),
    database
      .prepare(`DELETE FROM rate_limits WHERE (ip, window_start) IN (
        SELECT ip, window_start FROM rate_limits WHERE window_start <= ?1 ORDER BY window_start LIMIT ?2
      )`)
      .bind(now - 3600, ROWS_PER_BATCH),
    // Keep live tokens for code replay detection, even after the code's ten-minute TTL.
    database
      .prepare(`DELETE FROM oauth_tokens WHERE id IN (
        SELECT id FROM oauth_tokens WHERE expires_at <= ?1 ORDER BY expires_at LIMIT ?2
      )`)
      .bind(tokenCutoff, ROWS_PER_BATCH),
    database
      .prepare(`DELETE FROM oauth_tokens WHERE id IN (
        SELECT id FROM oauth_tokens WHERE revoked_at <= ?1 ORDER BY revoked_at LIMIT ?2
      )`)
      .bind(tokenCutoff, ROWS_PER_BATCH),
  ]
  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN && Date.now() < deadline; batch += 1) {
    // oxlint-disable-next-line no-await-in-loop -- commit each bounded batch before starting another; each statement binds two parameters
    const results = await database.batch(statements)
    const changes = results.reduce((total, result) => total + result.meta.changes, 0)
    deleted += changes
    if (changes === 0) {
      break
    }
  }
  return deleted
}

export const expiredAuthRowsJob = defineScheduled(async (controller, env) => {
  const now = Math.floor(controller.scheduledTime / 1000)
  await purgeExpiredAuthRows(env.DB, now)
  if (env.MEDIA_BUCKET !== undefined) {
    await purgeExpiredLogos(env.DB, env.MEDIA_BUCKET, now)
  }
})
