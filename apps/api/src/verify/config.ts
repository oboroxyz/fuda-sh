import { asHex } from '@fuda/sdk'
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
const asAddress = (s: string): Hex => asHex(s, 20) ?? ZERO_ADDRESS

export const verifyConfig = (env: Bindings, chain: ChainClient, now: number): VerifyDeps => ({
  chain,
  issuerAddress: asAddress(env.ISSUER_ADDRESS),
  now,
  sets: parseSchemaSets(env.EAS_SCHEMAS),
})
