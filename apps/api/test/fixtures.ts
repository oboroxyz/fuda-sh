import { hashSignal } from '@worldcoin/idkit-core/hashing'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { ZERO_UID } from '../src/chain/client.ts'
import type { FakeChain } from '../src/chain/fake-chain.ts'
import { encodeDelegationV1, encodeEntitlementV1 } from '../src/eas/codecs.ts'
import { SCHEMA_STRINGS, schemaUid } from '../src/eas/schemas.ts'
import type { Bindings } from '../src/env.ts'
import { testEnv } from './env.ts'

export const ENT = schemaUid(SCHEMA_STRINGS.entitlement)
export const DEL = schemaUid(SCHEMA_STRINGS.issuerDelegation)
export const ATT = schemaUid(SCHEMA_STRINGS.attendance)
// Stand-in for a future v2 Entitlement schema: nothing is ever seeded under it,
// it only proves that accepting a newer version keeps v1 rights revocable.
export const ENT_V2: Hex = `0x${'e2'.repeat(32)}`
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
  expirationTime: bigint
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
    expirationTime: over.expirationTime ?? 0n,
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

// A real EOA for the Signed tests: the holder of a Signed right, signing for real.
export const SIGNER_KEY = `0x${'5a'.repeat(32)}` as const
export const signer = privateKeyToAccount(SIGNER_KEY)
export const OTHER_KEY = `0x${'5b'.repeat(32)}` as const
export const other = privateKeyToAccount(OTHER_KEY)
export const signChallenge = async (message: string): Promise<Hex> => await signer.signMessage({ message })

// The action the World bindings are configured with in every suite that
// exercises the badge routes or the adapter. A 4.0 uniqueness proof carries the
// action it was made for and the adapter checks it against this binding, so the
// fixture and the test environment must name the same one or every proof is
// refused as made for something else.
export const WORLD_ACTION = 'ethtokyo2026-human'

// A World proof payload shaped like the `IDKitResultV4` the vendor actually
// returns for the shipped `proofOfHuman` preset. Three things about the shape
// matter to the adapter and are therefore real here rather than invented:
// the signal is not a field of its own — it reaches the server only as
// `responses[].signal_hash`, derived with the same `hashSignal` World App uses,
// which is why the adapter compares a hash rather than a uid; the credential is
// named by the numeric `issuer_schema_id` (1 = proof of human) and not by the
// `identifier` string beside it; and `action` is a required top-level field on a
// 4.0 uniqueness proof. `signalHash: null` drops the field entirely, the way a
// 4.0 item with no reattached hash arrives.
export const worldProof = (
  uid: string,
  overrides: {
    identifier?: string
    issuerSchemaId?: number
    protocolVersion?: string
    environment?: string
    action?: string
    signalHash?: string | null
  } = {},
) => {
  const signalHash = overrides.signalHash === undefined ? hashSignal(uid) : overrides.signalHash
  const item = {
    expires_at_min: 4_102_444_800,
    identifier: overrides.identifier ?? 'proof_of_human',
    issuer_schema_id: overrides.issuerSchemaId ?? 1,
    nullifier: '0xdead',
    proof: ['0x01', '0x02', '0x03', '0x04', '0xroot'],
  }
  return {
    action: overrides.action ?? WORLD_ACTION,
    environment: overrides.environment ?? 'production',
    nonce: '0x01',
    protocol_version: overrides.protocolVersion ?? '4.0',
    responses: [signalHash === null ? item : { ...item, signal_hash: signalHash }],
  }
}

// A 4.0 *session* proof, the one shape the adapter must refuse outright: its
// nullifier is bound to a randomised action, so it says nothing about
// uniqueness. Shaped like `IDKitResultSession` — `session_id` present, no
// top-level `action`, and `session_nullifier` in place of `nullifier`.
export const worldSessionProof = (uid: string) => ({
  environment: 'production',
  nonce: '0x01',
  protocol_version: '4.0',
  responses: [
    {
      expires_at_min: 4_102_444_800,
      identifier: 'proof_of_human',
      issuer_schema_id: 1,
      proof: ['0x01', '0x02', '0x03', '0x04', '0xroot'],
      session_nullifier: ['0xdead', '0xbeef'],
      signal_hash: hashSignal(uid),
    },
  ],
  session_id: 'session_abc',
})
