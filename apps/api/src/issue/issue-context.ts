import { asHex } from '@fuda/sdk'
import type { Context } from 'hono'
import type { Hex } from 'viem'

import { ZERO_ADDRESS, ZERO_UID } from '../chain/client.ts'
import { parseSchemaSets } from '../eas/schemas.ts'
import type { AppEnv } from '../env.ts'
import type { IssueContext } from './issue-right.ts'

// An unset binding reads as the zero value, which counts as unconfigured.
const configuredHex = (s: string, bytes: number, zero: Hex): Hex | null => {
  const hex = asHex(s, bytes)
  return hex === null || hex.toLowerCase() === zero ? null : hex
}

// null means "this deployment cannot issue": ISSUER_ADDRESS / DELEGATION_UID
// unset or zero, or a malformed EAS_SCHEMAS binding. All answer 502 chain_error.
// Shared by the admin POST /issue and the self-serve handle route.
export const issueContext = (c: Context<AppEnv>): IssueContext | null => {
  const issuerAddress = configuredHex(c.env.ISSUER_ADDRESS, 20, ZERO_ADDRESS)
  const delegationUid = configuredHex(c.env.DELEGATION_UID, 32, ZERO_UID)
  if (issuerAddress === null || delegationUid === null) {
    return null
  }
  let sets: ReturnType<typeof parseSchemaSets>
  try {
    sets = parseSchemaSets(c.env.EAS_SCHEMAS)
  } catch {
    return null
  }
  return {
    baseUrl: c.env.API_BASE_URL,
    chain: c.get('chain'),
    db: c.get('db'),
    delegationUid,
    issuerAddress,
    now: c.get('now')(),
    sets,
  }
}
