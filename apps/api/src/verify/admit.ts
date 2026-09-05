import type { EntryPath, Reason } from '@fuda/sdk'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { entryLog, slots } from '../db/schema.ts'

// The MVP issues one slot per right; named so a later multi-slot right can add
// its own rows without a migration.
export const DEFAULT_SLOT = 'default'

// SINGLE_USE consumption. INSERT OR IGNORE on the (uid, slot) primary key makes
// the write itself the lock: the slot is ours iff the insert changed a row, so
// two concurrent scans of the same pass cannot both be admitted.
export const consumeSlot = async (db: Db, uid: Hex, now: number): Promise<boolean> => {
  const res = await db
    .insert(slots)
    .values({ consumedAt: now, slot: DEFAULT_SLOT, uid })
    .onConflictDoNothing()
    .run()
  return res.meta.changes > 0
}

export interface EntryRow {
  uid: Hex
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  path: EntryPath
  at: number
}

// Appends one decision-shaped verdict to the entry log and returns its id, which
// the Attendance hook later uses to write `attendance_uid` back onto the row.
export const logEntry = async (db: Db, row: EntryRow): Promise<number> => {
  const inserted = await db.insert(entryLog).values(row).returning({ id: entryLog.id }).get()
  return inserted.id
}

export interface AdmitInfo {
  uid: Hex
  holder: Hex
  entryLogId: number
  now: number
  /** Keeps a best-effort side effect alive past the response, when the runtime offers one. */
  waitUntil: (p: Promise<unknown>) => void
}

export type AdmitHook = (info: AdmitInfo) => void

// Deployments without an Attendance hook admit without any further side effect.
export const noAdmitHook: AdmitHook = () => {
  // no Attendance hook wired: admission has no further side effect
}
