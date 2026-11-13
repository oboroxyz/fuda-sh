import { parseChainConfig } from '@fuda/chains'
import { asHex } from '@fuda/sdk'

import { ZERO_UID } from './chain/client.ts'
import type { ChainClient } from './chain/client.ts'
import { DEV_DELEGATION_UID, FakeChain } from './chain/fake-chain.ts'
import { createViemChain } from './chain/viem-chain.ts'
import { parseSchemaSets, SCHEMA_STRINGS, schemaUid } from './eas/schemas.ts'
import type { SchemaSets } from './eas/schemas.ts'
import type { Bindings } from './env.ts'

export type DevBindings = Bindings & { FAKE_AGREEMENT?: string; USE_FAKE_CHAIN?: string }

type FakeChainSignal = Pick<
  DevBindings,
  'BASE_RPC_URL' | 'CHAIN_ID' | 'SIGNER_PRIVATE_KEY' | 'USE_FAKE_CHAIN'
>

// Explicit local-dev opt-in only: never silently fake in production. A signer
// or RPC binding always wins over USE_FAKE_CHAIN, so a half-configured
// deployment fails closed onto the real chain rather than a fake one.
export const isFakeChainEnabled = (env: FakeChainSignal): boolean =>
  parseChainConfig(env.CHAIN_ID).id === parseChainConfig().id &&
  env.USE_FAKE_CHAIN === '1' &&
  env.SIGNER_PRIVATE_KEY === undefined &&
  env.BASE_RPC_URL === undefined

// `<registry>:<assetId>:<holder>` names one granted ERC-8432 agreement the fake chain starts
// with. A running stack has no other way to grant one, so the e2e target sets it to claim and
// present a pass on a requirement Card without a browser.
const seedAgreement = (chain: FakeChain, named: string | undefined): void => {
  const [registry, assetId, holder] = (named ?? '').split(':')
  const parts = {
    assetId: asHex(assetId ?? '', 32),
    holder: asHex(holder ?? '', 20),
    registry: asHex(registry ?? '', 20),
  }
  if (parts.assetId === null || parts.holder === null || parts.registry === null) {
    return
  }
  chain.seedAgreement({
    assetId: parts.assetId,
    creationMode: 0,
    holder: parts.holder,
    id: parts.assetId,
    registry: parts.registry,
    termsId: ZERO_UID,
  })
}

// One FakeChain per isolate so local dev keeps issued rights across requests.
let devChain: FakeChain | null = null
const createDevChain = (env: DevBindings): FakeChain => {
  // Base Account passkeys need ERC-1271/6492 verification. Only this read uses
  // Base Sepolia; attestations, delegation, and all writes remain simulated.
  const chain = new FakeChain({ verifyMessage: createViemChain(env).verifyMessage })
  const uid = chain.seedRootDelegation(schemaUid(SCHEMA_STRINGS.issuerDelegation), DEV_DELEGATION_UID)
  // oxlint-disable-next-line no-console -- one-time dev bootstrap hint, printed once per isolate
  console.warn(
    `[fuda-api] USE_FAKE_CHAIN=1: seeded root delegation. Set ISSUER_ADDRESS=${chain.signerAddress() ?? ''} and DELEGATION_UID=${uid} in local.vars in targets.jsonc.`,
  )
  seedAgreement(chain, env.FAKE_AGREEMENT)
  return chain
}

// Exported for tests: proves the FakeChain/viem-chain choice without needing a
// network call — `createViemChain` never touches the network at construction.
export const buildChain = (env: DevBindings): ChainClient => {
  if (isFakeChainEnabled(env)) {
    devChain ??= createDevChain(env)
    return devChain
  }
  return createViemChain(env)
}

const EMPTY_SETS: SchemaSets = { attendance: [], entitlement: [], issuerDelegation: [] }

// Announced once per isolate, not per request.
let schemaWarned = false

// A malformed EAS_SCHEMAS binding must not take the door down: the routes
// already answer 502 for it, and the hook simply has no schema to attest under.
// Exported for tests.
export const schemaSetsOf = (env: Pick<DevBindings, 'EAS_SCHEMAS'>): SchemaSets => {
  try {
    return parseSchemaSets(env.EAS_SCHEMAS)
  } catch {
    if (!schemaWarned) {
      schemaWarned = true
      // oxlint-disable-next-line no-console -- a malformed binding degrades every chain route; the log line is the only trace
      console.warn('[fuda-api] EAS_SCHEMAS is malformed: no schema is accepted and Attendance is disabled.')
    }
    return EMPTY_SETS
  }
}
