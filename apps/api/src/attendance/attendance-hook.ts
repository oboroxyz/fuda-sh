import { eq } from 'drizzle-orm'

import { ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { entryLog } from '../db/schema.ts'
import { encodeAttendanceV1 } from '../eas/codecs.ts'
import { newest } from '../eas/schemas.ts'
import type { SchemaSets } from '../eas/schemas.ts'
import type { AdmitHook, AdmitInfo } from '../verify/admit.ts'

export interface AttendanceDeps {
  chain: ChainClient
  db: Db
  sets: SchemaSets
}

// Spec §8: the on-chain entry evidence. Best-effort by construction — a lost
// record is acceptable, a failed admission is not — so every failure is
// swallowed here and this promise never rejects.
export const recordAttendance = async (deps: AttendanceDeps, info: AdmitInfo): Promise<void> => {
  const schema = newest(deps.sets.attendance)
  if (schema === null || deps.chain.signerAddress() === null) {
    return
  }
  try {
    const { uid } = await deps.chain.attest({
      data: encodeAttendanceV1({
        enteredAt: BigInt(info.now),
        holder: info.holder,
        rightUID: info.uid,
        slotId: ZERO_UID,
      }),
      expirationTime: 0n,
      recipient: info.holder,
      refUID: info.uid,
      revocable: true,
      schema: schema.uid,
    })
    await deps.db.update(entryLog).set({ attendanceUid: uid }).where(eq(entryLog.id, info.entryLogId))
  } catch (error) {
    // oxlint-disable-next-line no-console -- best-effort side effect: the log line is the only trace of a lost Attendance record
    console.warn('[fuda-api] Attendance attest failed', error)
  }
}

// The AdmitHook the api wires in production. It only schedules; it cannot throw.
export const attendanceHook =
  (deps: AttendanceDeps): AdmitHook =>
  (info) => {
    info.waitUntil(recordAttendance(deps, info))
  }
