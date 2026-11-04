import { asHex } from '@fuda/sdk'
import type { Hex } from 'viem'

import { ZERO_ADDRESS } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import { parseSchemaSets } from '../eas/schemas.ts'
import type { SchemaSets } from '../eas/schemas.ts'
import type { Bindings } from '../env.ts'
import { offchainDomain } from '../issue/issue-offchain.ts'
import type { OffchainVerifyDeps } from './verify-offchain.ts'

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

const retiredSigners = (value = ''): Hex[] => {
  if (value.trim() === '') {
    return []
  }
  return value.split(',').map((entry) => {
    const address = asHex(entry.trim(), 20)
    if (address === null || address === ZERO_ADDRESS) {
      throw new Error('OFFCHAIN_RETIRED_SIGNERS must contain comma-separated nonzero addresses')
    }
    return address
  })
}

export const offchainVerifyConfig = (env: Bindings, chain: ChainClient, now: number): OffchainVerifyDeps => ({
  chain,
  domain: offchainDomain(env, chain),
  now,
  retiredSigners: retiredSigners(env.OFFCHAIN_RETIRED_SIGNERS),
})
