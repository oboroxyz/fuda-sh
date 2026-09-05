import { asc, gte } from 'drizzle-orm'
import { Hono } from 'hono'

import { syncAnnouncements } from '../announcements/sync.ts'
import { announcements } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { DEFAULT_BUDGET, rateLimit } from '../middleware/rate-limit.ts'

export const ANNOUNCEMENTS_LIMIT = 1000

export const announcementsRoutes = new Hono<AppEnv>()

// The cached ERC-5564 log served to member apps (spec §3): the api never learns
// which rows are the caller's — matching happens client-side with the viewing
// key. The only budgeted route in the MVP: it is open, unauthenticated, and each
// call may cost RPC reads.
announcementsRoutes.get('/announcements', rateLimit({ budget: DEFAULT_BUDGET }), async (c) => {
  const floor = c.get('announcerFromBlock')
  const fromParam = Math.trunc(Number(c.req.query('fromBlock') ?? '0'))
  const fromBlock = Number.isFinite(fromParam) && fromParam >= 0 ? fromParam : 0
  const db = c.get('db')
  const synced = await syncAnnouncements({
    chain: c.get('chain'),
    db,
    fromBlock: floor,
  })
  const rows = await db
    .select()
    .from(announcements)
    .where(gte(announcements.blockNumber, fromBlock))
    .orderBy(asc(announcements.blockNumber), asc(announcements.logIndex))
    .limit(ANNOUNCEMENTS_LIMIT)
  // "Nothing was ever synced" is the cursor's absence, not the row count: a
  // persisted cursor over a range that held no announcements still answers 200
  // with an empty list, and rows left behind by a wiped sync_state answer 502
  // rather than passing off an unanchored cache as current.
  if (!synced.ok && synced.syncedTo === null) {
    return errorResponse(c, 'rpc_unavailable', 502)
  }
  c.header('cache-control', 'no-store')
  return jsonResponse(c, { announcements: rows, syncedTo: synced.syncedTo })
})
