import type { VerifyOutcome } from './verify-uid.ts'

// Both QR endpoints check this before SINGLE_USE consumption or Stamp credit.
export const qrOutcome = (out: VerifyOutcome): VerifyOutcome =>
  out.decision === 'ADMIT' && out.canonical.level !== 0
    ? { ...out, decision: 'REJECT', reason: 'LEVEL_REQUIRED' }
    : out
