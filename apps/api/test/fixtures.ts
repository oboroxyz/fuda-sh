import type { Hex } from 'viem'

import { ZERO_UID } from '../src/chain/client.ts'
import type { FakeChain } from '../src/chain/fake-chain.ts'
import { encodeDelegationV1, encodeEntitlementV1 } from '../src/eas/codecs.ts'
import { SCHEMA_STRINGS, schemaUid } from '../src/eas/schemas.ts'
import type { Bindings } from '../src/env.ts'
import { testEnv } from './env.ts'

export const ENT = schemaUid(SCHEMA_STRINGS.entitlement)
export const DEL = schemaUid(SCHEMA_STRINGS.issuerDelegation)
export const ATT = schemaUid(SCHEMA_STRINGS.attendance)
export const ROOT: Hex = `0x${'f0'.repeat(20)}`
export const HOLDER: Hex = `0x${'11'.repeat(20)}`
export const NOW = 1_757_000_000

export const seedRoot = (chain: FakeChain): Hex =>
  chain.seed({
    attester: ROOT,
    data: encodeDelegationV1({ active: true, issuer: ROOT, name: 'fuda root' }),
    expirationTime: 0n,
    recipient: ROOT,
    refUID: ZERO_UID,
    revocable: true,
    revocationTime: 0n,
    schema: DEL,
    time: 1n,
  })

export type RightOverrides = Partial<{
  level: number
  usageModel: number
  tier: number
  validFrom: bigint
  validUntil: bigint
  holder: Hex
  refUID: Hex
}>

export const seedRight = (chain: FakeChain, delegationUid: Hex, over: RightOverrides = {}): Hex =>
  chain.seed({
    attester: ROOT,
    data: encodeEntitlementV1({
      holder: over.holder ?? HOLDER,
      issuer: ROOT,
      level: over.level ?? 0,
      metaURI: '',
      serial: ZERO_UID,
      tier: over.tier ?? 1,
      usageModel: over.usageModel ?? 1,
      validFrom: over.validFrom ?? 0n,
      validUntil: over.validUntil ?? 0n,
    }),
    expirationTime: 0n,
    recipient: over.holder ?? HOLDER,
    refUID: over.refUID ?? delegationUid,
    revocable: true,
    revocationTime: 0n,
    schema: ENT,
    time: 1n,
  })

export const configuredEnv = (delegationUid: Hex, overrides: Partial<Bindings> = {}): Bindings =>
  testEnv({
    ADMIN_TOKEN: undefined,
    DELEGATION_UID: delegationUid,
    EAS_SCHEMAS: JSON.stringify({
      attendance: [{ uid: ATT, version: 1 }],
      entitlement: [{ uid: ENT, version: 1 }],
      issuerDelegation: [{ uid: DEL, version: 1 }],
    }),
    ISSUER_ADDRESS: ROOT,
    ...overrides,
  })
