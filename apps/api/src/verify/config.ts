import type { Hex } from 'viem'

import { ZERO_ADDRESS } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import { parseSchemaSets } from '../eas/schemas.ts'
import type { SchemaSets } from '../eas/schemas.ts'
import type { Bindings } from '../env.ts'

export interface VerifyDeps {
  chain: ChainClient
  sets: SchemaSets
  issuerAddress: Hex
  now: number
}

// A malformed ISSUER_ADDRESS becomes the zero address, which verifyUid reports
// as DELEGATION_CONFIG_MISSING — a decision-shaped answer rather than a crash.
// Annotated (not cast): the regex guarantees the 0x prefix, so the contextually
// typed template literal narrows to Hex directly.
const asAddress = (s: string): Hex => {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(s)) {
    return ZERO_ADDRESS
  }
  const addr: Hex = `0x${s.slice(2)}`
  return addr
}

export const verifyConfig = (env: Bindings, chain: ChainClient, now: number): VerifyDeps => ({
  chain,
  issuerAddress: asAddress(env.ISSUER_ADDRESS),
  now,
  sets: parseSchemaSets(env.EAS_SCHEMAS),
})
