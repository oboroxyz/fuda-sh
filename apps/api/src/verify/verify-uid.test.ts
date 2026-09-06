import type { Reason } from '@fuda/sdk'
import { getAddress } from 'viem'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { ChainError, ZERO_UID } from '../chain/client.ts'
import { FakeChain } from '../chain/fake-chain.ts'
import { encodeDelegationV1, encodeEntitlementV1 } from '../eas/codecs.ts'
import { SCHEMA_STRINGS, schemaUid } from '../eas/schemas.ts'
import { verifyUid } from './verify-uid.ts'
import type { VerifyDeps } from './verify-uid.ts'

const ENT = schemaUid(SCHEMA_STRINGS.entitlement)
const DEL = schemaUid(SCHEMA_STRINGS.issuerDelegation)
// EIP-55 checksummed: FakeChain and viem's abi decoder both hand addresses back this way.
const ROOT: Hex = getAddress(`0x${'f0'.repeat(20)}`)
const HOLDER: Hex = getAddress(`0x${'11'.repeat(20)}`)
const ZERO_ADDR: Hex = `0x${'00'.repeat(20)}`
const NOW = 1_757_000_000

interface RightOverrides {
  level?: number
  usageModel?: number
  validFrom?: bigint
  validUntil?: bigint
  refUID?: Hex
  schema?: Hex
  attester?: Hex
  revocationTime?: bigint
  expirationTime?: bigint
  data?: Hex
}

describe(verifyUid, () => {
  let chain: FakeChain
  let deps: VerifyDeps
  let delegationUid: Hex

  const seedDelegation = (opts: { issuer?: Hex; active?: boolean; attester?: Hex; data?: Hex } = {}): Hex =>
    chain.seed({
      attester: opts.attester ?? ROOT,
      data:
        opts.data ??
        encodeDelegationV1({
          active: opts.active ?? true,
          issuer: opts.issuer ?? ROOT,
          name: 'fuda root',
        }),
      expirationTime: 0n,
      recipient: ROOT,
      refUID: ZERO_UID,
      revocable: true,
      revocationTime: 0n,
      schema: DEL,
      time: 1n,
    })

  const seedRight = (over: RightOverrides = {}): Hex =>
    chain.seed({
      attester: over.attester ?? ROOT,
      data:
        over.data ??
        encodeEntitlementV1({
          holder: HOLDER,
          issuer: ROOT,
          level: over.level ?? 0,
          metaURI: '',
          serial: ZERO_UID,
          tier: 1,
          usageModel: over.usageModel ?? 1,
          validFrom: over.validFrom ?? 0n,
          validUntil: over.validUntil ?? 0n,
        }),
      expirationTime: over.expirationTime ?? 0n,
      recipient: HOLDER,
      refUID: over.refUID ?? delegationUid,
      revocable: true,
      revocationTime: over.revocationTime ?? 0n,
      schema: over.schema ?? ENT,
      time: 1n,
    })

  const reasonOf = async (uid: Hex, over: Partial<VerifyDeps> = {}): Promise<Reason> => {
    const out = await verifyUid({ ...deps, ...over }, uid)
    return out.reason
  }

  const decisionOf = async (uid: Hex): Promise<string> => {
    const out = await verifyUid(deps, uid)
    return out.decision
  }

  beforeEach(() => {
    chain = new FakeChain({ signer: ROOT })
    delegationUid = seedDelegation()
    deps = {
      chain,
      issuerAddress: ROOT,
      now: NOW,
      sets: {
        attendance: [],
        entitlement: [{ uid: ENT, version: 1 }],
        issuerDelegation: [{ uid: DEL, version: 1 }],
      },
    }
  })

  describe('§6 ordering', () => {
    it('ADMITs a valid right with decoded entitlement and delegation views', async () => {
      const out = await verifyUid(deps, seedRight())
      expect(out.decision).toBe('ADMIT')
      expect(out.reason).toBe('OK')
      expect(out.entitlement).toMatchObject({
        holder: HOLDER,
        level: 0,
        schemaVersion: 1,
        tier: 1,
        usageModel: 1,
      })
      expect(out.delegation).toStrictEqual({ active: true, issuer: ROOT, name: 'fuda root' })
      expect(out.attester).toBe(ROOT)
    })

    it('rejects NOT_FOUND for an unknown uid', async () => {
      await expect(reasonOf(`0x${'ee'.repeat(32)}`)).resolves.toBe('NOT_FOUND')
    })

    it('rejects WRONG_SCHEMA for a uid outside the accepted set', async () => {
      await expect(reasonOf(seedRight({ schema: `0x${'99'.repeat(32)}` }))).resolves.toBe('WRONG_SCHEMA')
    })

    it('rejects WRONG_SCHEMA when the payload under an accepted schema cannot be decoded', async () => {
      await expect(reasonOf(seedRight({ data: '0x' }))).resolves.toBe('WRONG_SCHEMA')
    })

    it('omits the entitlement but reports the attester when the payload cannot be decoded', async () => {
      const out = await verifyUid(deps, seedRight({ data: '0xdeadbeef' }))
      expect(out.decision).toBe('REJECT')
      expect(out.entitlement).toBeUndefined()
      expect(out.attester).toBe(ROOT)
    })

    it('rejects REVOKED', async () => {
      await expect(reasonOf(seedRight({ revocationTime: 5n }))).resolves.toBe('REVOKED')
    })

    it('rejects EXPIRED for an attestation past its EAS expirationTime', async () => {
      const out = await verifyUid(deps, seedRight({ expirationTime: BigInt(NOW - 1) }))
      expect(out.decision).toBe('REJECT')
      expect(out.reason).toBe('EXPIRED')
      expect(out.entitlement?.holder).toBe(HOLDER)
    })

    it('ADMITs while the EAS expirationTime is still in the future', async () => {
      await expect(decisionOf(seedRight({ expirationTime: BigInt(NOW + 100) }))).resolves.toBe('ADMIT')
    })

    it('treats the EAS expirationTime as inclusive at the bound', async () => {
      await expect(decisionOf(seedRight({ expirationTime: BigInt(NOW) }))).resolves.toBe('ADMIT')
    })

    it('checks EAS expirationTime before revocation and the usage-model check', async () => {
      await expect(
        reasonOf(seedRight({ expirationTime: BigInt(NOW - 1), revocationTime: 5n })),
      ).resolves.toBe('REVOKED')
      await expect(reasonOf(seedRight({ expirationTime: BigInt(NOW - 1), usageModel: 3 }))).resolves.toBe(
        'EXPIRED',
      )
    })

    it('rejects UNKNOWN_USAGE_MODEL for usageModel 3', async () => {
      await expect(reasonOf(seedRight({ usageModel: 3 }))).resolves.toBe('UNKNOWN_USAGE_MODEL')
    })

    it('rejects NOT_YET_VALID and EXPIRED, with 0 meaning unbounded', async () => {
      await expect(reasonOf(seedRight({ validFrom: BigInt(NOW + 10) }))).resolves.toBe('NOT_YET_VALID')
      await expect(reasonOf(seedRight({ validUntil: BigInt(NOW - 10) }))).resolves.toBe('EXPIRED')
      await expect(decisionOf(seedRight())).resolves.toBe('ADMIT')
    })

    it('treats the validity window as inclusive at both ends', async () => {
      await expect(decisionOf(seedRight({ validFrom: BigInt(NOW), validUntil: BigInt(NOW) }))).resolves.toBe(
        'ADMIT',
      )
    })

    it('reports revocation before usage model and validity', async () => {
      await expect(reasonOf(seedRight({ revocationTime: 5n, usageModel: 3, validUntil: 1n }))).resolves.toBe(
        'REVOKED',
      )
    })

    it('carries the decoded entitlement and attester on a REJECT', async () => {
      const out = await verifyUid(deps, seedRight({ validUntil: 1n }))
      expect(out.decision).toBe('REJECT')
      expect(out.entitlement).toMatchObject({ holder: HOLDER, validUntil: 1 })
      expect(out.attester).toBe(ROOT)
    })

    it('does not reject on level (that is the QR route’s job)', async () => {
      const out = await verifyUid(deps, seedRight({ level: 1 }))
      expect(out.decision).toBe('ADMIT')
      expect(out.entitlement?.level).toBe(1)
    })
  })

  describe('delegation', () => {
    it('rejects NO_DELEGATION when the reference is zero, missing or revoked', async () => {
      await expect(reasonOf(seedRight({ refUID: ZERO_UID }))).resolves.toBe('NO_DELEGATION')
      await expect(reasonOf(seedRight({ refUID: `0x${'ee'.repeat(32)}` }))).resolves.toBe('NO_DELEGATION')
      chain.revokeAt(delegationUid, 5n)
      await expect(reasonOf(seedRight())).resolves.toBe('NO_DELEGATION')
    })

    it('rejects NO_DELEGATION when the delegation is inactive or attested by someone else', async () => {
      await expect(reasonOf(seedRight({ refUID: seedDelegation({ active: false }) }))).resolves.toBe(
        'NO_DELEGATION',
      )
      await expect(reasonOf(seedRight({ refUID: seedDelegation({ attester: HOLDER }) }))).resolves.toBe(
        'NO_DELEGATION',
      )
    })

    it('rejects NO_DELEGATION when the referenced attestation is off the delegation schema', async () => {
      const offSchema = chain.seed({
        attester: ROOT,
        data: encodeDelegationV1({ active: true, issuer: ROOT, name: 'x' }),
        expirationTime: 0n,
        recipient: ROOT,
        refUID: ZERO_UID,
        revocable: true,
        revocationTime: 0n,
        schema: ENT,
        time: 1n,
      })
      await expect(reasonOf(seedRight({ refUID: offSchema }))).resolves.toBe('NO_DELEGATION')
    })

    it('rejects NO_DELEGATION when the delegation payload cannot be decoded', async () => {
      await expect(reasonOf(seedRight({ refUID: seedDelegation({ data: '0x' }) }))).resolves.toBe(
        'NO_DELEGATION',
      )
    })

    it('rejects ISSUER_NOT_DELEGATED when the delegation names another issuer', async () => {
      await expect(reasonOf(seedRight({ refUID: seedDelegation({ issuer: HOLDER }) }))).resolves.toBe(
        'ISSUER_NOT_DELEGATED',
      )
    })

    it('rejects DELEGATION_UNAVAILABLE when the delegation read fails (fail closed)', async () => {
      const uid = seedRight()
      const original = chain.readAttestation.bind(chain)
      let calls = 0
      chain.readAttestation = async (u) => {
        calls += 1
        if (calls === 1) {
          return await original(u)
        }
        throw new ChainError('rpc')
      }
      await expect(reasonOf(uid)).resolves.toBe('DELEGATION_UNAVAILABLE')
    })

    it('rejects DELEGATION_CONFIG_MISSING when ISSUER_ADDRESS is zero', async () => {
      await expect(reasonOf(seedRight(), { issuerAddress: ZERO_ADDR })).resolves.toBe(
        'DELEGATION_CONFIG_MISSING',
      )
    })

    it('rejects DELEGATION_CONFIG_MISSING when the delegation set is empty', async () => {
      const sets = { ...deps.sets, issuerDelegation: [] }
      await expect(reasonOf(seedRight(), { sets })).resolves.toBe('DELEGATION_CONFIG_MISSING')
    })

    it('rethrows ChainError when the Entitlement read itself fails', async () => {
      const uid = seedRight()
      chain.failReads = true
      await expect(verifyUid(deps, uid)).rejects.toBeInstanceOf(ChainError)
    })
  })
})
