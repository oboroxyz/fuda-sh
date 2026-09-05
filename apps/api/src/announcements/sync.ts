import { eq } from 'drizzle-orm'

import { ChainError } from '../chain/client.ts'
import type { AnnouncementLog, ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { announcements, syncState } from '../db/schema.ts'

// Public Base Sepolia RPCs cap eth_getLogs ranges (spec §3).
export const CHUNK_BLOCKS = 1000
// A cold deployment warms up across a few requests instead of spending one
// request's whole CPU budget on a deep history.
export const SYNC_CHUNKS_PER_REQUEST = 5
export const SYNC_KEY = 'announcements'
// D1 allows at most 100 bound parameters per query
// (developers.cloudflare.com/d1/platform/limits). An announcement row binds 8,
// so a multi-row INSERT has to be sliced or the statement is rejected on
// Cloudflare — a chunk can easily carry more than a dozen logs.
export const INSERT_ROWS = 12

export interface SyncDeps {
  chain: ChainClient
  db: Db
  fromBlock: number
}

export type SyncResult = { ok: true; syncedTo: number } | { ok: false; syncedTo: number | null }

const readCursor = async (db: Db): Promise<number | null> => {
  const row = await db
    .select({ value: syncState.value })
    .from(syncState)
    .where(eq(syncState.key, SYNC_KEY))
    .get()
  return row?.value ?? null
}

const insertLogs = async (db: Db, logs: AnnouncementLog[]): Promise<void> => {
  for (let i = 0; i < logs.length; i += INSERT_ROWS) {
    // oxlint-disable-next-line no-await-in-loop -- slices of one chunk are applied in order; parallel writes would reorder the cursor
    await db
      .insert(announcements)
      .values(logs.slice(i, i + INSERT_ROWS))
      .onConflictDoNothing()
  }
}

// Lazily pulls scheme-1 announcements into D1, ≤1000 blocks at a time, and
// persists the cursor after every chunk so partial progress survives an RPC
// failure or the per-request cap. Logs are keyed by (tx_hash, log_index), so a
// re-scan of an already-held range is a no-op.
export const syncAnnouncements = async (deps: SyncDeps): Promise<SyncResult> => {
  let cursor = (await readCursor(deps.db)) ?? deps.fromBlock - 1
  const started = cursor >= deps.fromBlock ? cursor : null
  try {
    const head = await deps.chain.blockNumber()
    for (let i = 0; i < SYNC_CHUNKS_PER_REQUEST && cursor < head; i += 1) {
      const to = Math.min(cursor + CHUNK_BLOCKS, head)
      // oxlint-disable-next-line no-await-in-loop -- chunks are applied in block order; the cursor must not skip ahead
      const logs = await deps.chain.getAnnouncementLogs(cursor + 1, to)
      // oxlint-disable-next-line no-await-in-loop -- see above
      await insertLogs(deps.db, logs)
      // oxlint-disable-next-line no-await-in-loop -- see above
      await deps.db
        .insert(syncState)
        .values({ key: SYNC_KEY, value: to })
        .onConflictDoUpdate({ set: { value: to }, target: syncState.key })
      cursor = to
    }
    return { ok: true, syncedTo: cursor }
  } catch (error) {
    if (error instanceof ChainError) {
      return { ok: false, syncedTo: cursor >= deps.fromBlock ? cursor : started }
    }
    throw error
  }
}
