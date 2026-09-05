import { eq, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'

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
// Base Sepolia reorgs are shallow, but a log read at the tip can still be
// re-org'd out after its row and the cursor landed, and the cursor never walks
// back. Syncing only up to head - CONFIRMATIONS trades a few seconds of
// freshness for rows that are settled.
export const CONFIRMATIONS = 5

export interface SyncDeps {
  chain: ChainClient
  db: Db
  fromBlock: number
  // How far behind the head the walk stops. Defaults to CONFIRMATIONS; the
  // fake-chain dev path passes 0, because the fake head only moves when a right
  // is issued and a five-block wait would hide the pass just announced.
  confirmations?: number
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

const rowSlices = (logs: AnnouncementLog[]): AnnouncementLog[][] => {
  const slices: AnnouncementLog[][] = []
  for (let i = 0; i < logs.length; i += INSERT_ROWS) {
    slices.push(logs.slice(i, i + INSERT_ROWS))
  }
  return slices
}

// One chunk's rows and its cursor reach D1 as a single batch: one binding call
// (a statement per slice would spend the Workers subrequest budget on a busy
// chunk, failing before the cursor advances and re-failing on every later
// request) and one implicit transaction, so the cursor can never advance past
// rows that did not land. The cursor statement leads the batch only to keep the
// array a non-empty tuple; the batch is atomic, so its position carries no
// meaning.
const applyChunk = async (db: Db, logs: AnnouncementLog[], to: number): Promise<void> => {
  const cursorWrite: BatchItem<'sqlite'> = db
    .insert(syncState)
    .values({ key: SYNC_KEY, value: to })
    // `max(...)`, not a plain assignment: two requests can sync concurrently, and
    // the slower one must not pull the cursor back to its own lower `to` — that
    // would re-walk (and, with a wiped rows table, re-read) settled history.
    .onConflictDoUpdate({ set: { value: sql`max(${syncState.value}, ${to})` }, target: syncState.key })
  const inserts = rowSlices(logs).map((rows): BatchItem<'sqlite'> =>
    db.insert(announcements).values(rows).onConflictDoNothing(),
  )
  await db.batch([cursorWrite, ...inserts])
}

// Lazily pulls scheme-1 announcements into D1, ≤1000 blocks at a time and never
// closer than CONFIRMATIONS blocks to the head, and persists the cursor after
// every chunk so partial progress survives an RPC failure or the per-request
// cap. Logs are keyed by (tx_hash, log_index), so a re-scan of an already-held
// range is a no-op.
export const syncAnnouncements = async (deps: SyncDeps): Promise<SyncResult> => {
  const persisted = await readCursor(deps.db)
  // Floored at the configured start: a persisted cursor from before
  // `fromBlock` was raised (or a stale/foreign value) must never pull the
  // walk back below the configured floor, in dev or production.
  let cursor = Math.max(persisted ?? deps.fromBlock - 1, deps.fromBlock - 1)
  try {
    // Never below `fromBlock - 1`: on a chain younger than CONFIRMATIONS blocks
    // (or a floor set at the very tip) the confirmed head would otherwise go
    // negative and the walk would run backwards.
    const behind = deps.confirmations ?? CONFIRMATIONS
    const head = Math.max((await deps.chain.blockNumber()) - behind, deps.fromBlock - 1)
    for (let i = 0; i < SYNC_CHUNKS_PER_REQUEST && cursor < head; i += 1) {
      const to = Math.min(cursor + CHUNK_BLOCKS, head)
      // oxlint-disable-next-line no-await-in-loop -- chunks are applied in block order; the cursor must not skip ahead
      const logs = await deps.chain.getAnnouncementLogs(cursor + 1, to)
      // oxlint-disable-next-line no-await-in-loop -- see above
      await applyChunk(deps.db, logs, to)
      cursor = to
    }
    return { ok: true, syncedTo: cursor }
  } catch (error) {
    if (error instanceof ChainError) {
      return { ok: false, syncedTo: cursor >= deps.fromBlock ? cursor : null }
    }
    throw error
  }
}
