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

// A no-op hook is a deployment condition, not a per-request one, so it is
// announced once per isolate rather than on every admission.
let noopWarned = false

const warnNoop = (why: string): void => {
  if (noopWarned) {
    return
  }
  noopWarned = true
  // oxlint-disable-next-line no-console -- a silently disabled Attendance hook is otherwise invisible in wrangler tail
  console.warn(`[fuda-api] Attendance is disabled: ${why}. Admissions continue unrecorded on chain.`)
}

// docs/specs/attestation-model.md#entitlement-lifecycle: the on-chain entry evidence. Best-effort by construction — a lost
// record is acceptable, a failed admission is not — so every failure is
// swallowed here and this promise never rejects.
export const recordAttendance = async (deps: AttendanceDeps, info: AdmitInfo): Promise<void> => {
  const schema = newest(deps.sets.attendance)
  if (schema === null) {
    warnNoop('no Attendance schema is configured (EAS_SCHEMAS is empty or malformed)')
    return
  }
  if (deps.chain.signerAddress() === null) {
    warnNoop('this deployment has no signer')
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
