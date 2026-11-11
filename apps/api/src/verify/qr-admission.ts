import type { VerifyResponse } from '@fuda/sdk'
import type { Context } from 'hono'
import type { Hex } from 'viem'

import { ChainError } from '../chain/client.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse } from '../json.ts'
import { presentationRequirements } from '../requirements/presentation.ts'
import type { VerifyOutcome } from './verify-uid.ts'

// Both QR endpoints check this before SINGLE_USE consumption or Stamp credit.
export const qrOutcome = (out: VerifyOutcome): VerifyOutcome =>
  out.decision === 'ADMIT' && out.canonical.level !== 0
    ? { ...out, decision: 'REJECT', reason: 'LEVEL_REQUIRED' }
    : out

export const qrRequirements = async (
  c: Context<AppEnv>,
  uid: Hex,
  out: VerifyOutcome,
): Promise<
  | { ok: false; res: Response }
  | { ok: true; out: VerifyOutcome; fields?: Pick<VerifyResponse, 'requirement' | 'requirements'> }
> => {
  if (out.decision !== 'ADMIT') {
    return { ok: true, out }
  }
  try {
    const checked = await presentationRequirements(
      c.get('db'),
      c.get('chain'),
      uid,
      c.env,
      out.requirementCard,
    )
    return checked.met
      ? {
          fields: checked.evidence.length === 0 ? {} : { requirements: checked.evidence },
          ok: true,
          out,
        }
      : {
          fields: { requirement: checked.requirement },
          ok: true,
          out: { ...out, decision: 'REJECT', reason: 'REQUIREMENT_UNMET' },
        }
  } catch (error) {
    if (error instanceof ChainError) {
      return { ok: false, res: errorResponse(c, 'chain_error', 502) }
    }
    throw error
  }
}
