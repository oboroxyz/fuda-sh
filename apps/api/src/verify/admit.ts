import { USAGE_MODEL } from '@fuda/sdk'
import type { EntryPath, Reason } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'

import { ZERO_ADDRESS } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cards, entryLog, members, slots } from '../db/schema.ts'
import type { Entitlement } from '../eas/codecs.ts'

// The MVP issues one slot per right; named so a later multi-slot right can add
// its own rows without a migration.
const DEFAULT_SLOT = 'default'

export interface EntryRow {
  uid: Hex
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  path: EntryPath
  at: number
}

const storedEntry = async (db: Db, row: EntryRow) => {
  const card = await db
    .select({ identity: cards.identity })
    .from(members)
    .innerJoin(cards, eq(cards.id, members.cardId))
    .where(eq(members.attestationUid, row.uid))
    .get()
  return card?.identity === 'sensitive'
    ? { at: row.at, decision: null, path: null, reason: null, uid: row.uid }
    : row
}

export const logEntry = async (db: Db, row: EntryRow): Promise<number> => {
  const stored = await storedEntry(db, row)
  const inserted = await db.insert(entryLog).values(stored).returning({ id: entryLog.id }).get()
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
  const stored = await storedEntry(db, { at: now, decision: 'ADMIT', path, reason: 'OK', uid })
  try {
    const [, inserted] = await db.batch([
      db.insert(slots).values({ consumedAt: stored.decision === null ? 0 : now, slot: DEFAULT_SLOT, uid }),
      db.insert(entryLog).values(stored).returning({ id: entryLog.id }),
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

export interface AdmitContext {
  db: Db
  uid: Hex
  canonical: Pick<Entitlement, 'holder' | 'usageModel'>
  path: EntryPath
  now: number
  onAdmit: AdmitHook
  waitUntil: (p: Promise<unknown>) => void
}

export type AdmitOutcome =
  | { admitted: true; entryLogId: number }
  | { admitted: false; reason: 'ALREADY_USED' }

// One read, for an on-chain right only: whether the card it was issued under
// writes an Attendance (docs/specs/attestation-model.md#entitlement-lifecycle). A right with no
// card, which is what admin issuance makes, keeps the old behavior and records.
// An unreadable card fails closed: a public record is permanent, a lost one is
// not.
const cardRecordsAttendance = async (db: Db, uid: Hex): Promise<boolean> => {
  try {
    const row = await db
      .select({ attendance: cards.attendance })
      .from(members)
      .innerJoin(cards, eq(cards.id, members.cardId))
      .where(eq(members.attestationUid, uid))
      .get()
    return row === undefined || row.attendance !== 0
  } catch (error) {
    // oxlint-disable-next-line no-console -- without the card the choice is unknown, so no public record is written; this line is the only trace
    console.warn('[fuda-api] could not read the card for an Attendance', error)
    return false
  }
}

export const notifyAdmission = async (ctx: AdmitContext, entryLogId: number): Promise<void> => {
  // An offchain right keeps its visits in D1 (docs/specs/attestation-model.md#offchain-rights),
  // and has no holder for an Attendance to name.
  if (ctx.canonical.holder === ZERO_ADDRESS) {
    return
  }
  if (!(await cardRecordsAttendance(ctx.db, ctx.uid))) {
    return
  }
  try {
    ctx.onAdmit({
      entryLogId,
      holder: ctx.canonical.holder,
      now: ctx.now,
      uid: ctx.uid,
      waitUntil: ctx.waitUntil,
    })
  } catch {
    // Attendance is best-effort (docs/specs/attestation-model.md#operational-reconciliation): a failed side effect never fails an admission
  }
}

// The spine every entry path shares once the chain verification (and, for the signature path, the
// challenge and the signature) have said the right may enter: burn the slot of a
// SINGLE_USE right or log a plain ADMIT, then fire the best-effort hook. The
// caller still writes its own REJECT row for ALREADY_USED, because the REJECT's
// response shape differs per path.
export const admitAndHook = async (ctx: AdmitContext): Promise<AdmitOutcome> => {
  let entryLogId: number
  if (ctx.canonical.usageModel === USAGE_MODEL.SINGLE_USE) {
    const admitted = await admitSingleUse(ctx.db, ctx.uid, ctx.path, ctx.now)
    if (!admitted.admitted) {
      return { admitted: false, reason: 'ALREADY_USED' }
    }
    ;({ entryLogId } = admitted)
  } else {
    entryLogId = await logEntry(ctx.db, {
      at: ctx.now,
      decision: 'ADMIT',
      path: ctx.path,
      reason: 'OK',
      uid: ctx.uid,
    })
  }
  await notifyAdmission(ctx, entryLogId)
  return { admitted: true, entryLogId }
}
