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

export type AdmitResult = { admitted: true; entryLogId: number } | { admitted: false }

// SQLite names the violated key in its message; D1 wraps it but keeps the text.
const SLOT_TAKEN_RE = /UNIQUE constraint failed: slots\.uid, slots\.slot/u

// SINGLE_USE admission as one transaction: the slot row and the ADMIT log row
// commit together or not at all. The slot insert is a plain INSERT, so a second
// scan violates the (uid, slot) primary key and D1 rolls the whole batch back —
// the ADMIT row is never written for a slot that was already burned, and two
// concurrent scans cannot both commit. The caller logs the REJECT separately;
// that single statement has nothing to lose.
export const admitSingleUse = async (
  db: Db,
  uid: Hex,
  path: EntryPath,
  now: number,
): Promise<AdmitResult> => {
  try {
    const [, inserted] = await db.batch([
      db.insert(slots).values({ consumedAt: now, slot: DEFAULT_SLOT, uid }),
      db
        .insert(entryLog)
        .values({ at: now, decision: 'ADMIT', path, reason: 'OK', uid })
        .returning({ id: entryLog.id }),
    ])
    const [row] = inserted
    if (row === undefined) {
      throw new Error('entry_log insert returned no row')
    }
    return { admitted: true, entryLogId: row.id }
  } catch (error) {
    if (error instanceof Error && SLOT_TAKEN_RE.test(error.message)) {
      return { admitted: false }
    }
    throw error
  }
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
