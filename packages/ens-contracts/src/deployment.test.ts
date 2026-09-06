import { zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  ENS_HACKATHON_CHAIN,
  ENS_HACKATHON_CONTRACTS,
  ENS_RUNTIME_CODE_HASHES,
  toRegistryExpiry,
} from './index.ts'

describe('dedicated deployment manifest', () => {
  it('pins the complete unique 40-address namespace and resolver override', () => {
    expect(ENS_HACKATHON_CHAIN.id).toBe(11_155_111)
    expect(ENS_HACKATHON_CHAIN.contracts.ensUniversalResolver?.address).toBe(
      '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
    )
    const addresses = Object.values(ENS_HACKATHON_CONTRACTS)
    expect(addresses).toHaveLength(40)
    expect(new Set(addresses.map((address) => address.toLowerCase())).size).toBe(40)
    expect(addresses).not.toContain(zeroAddress)
    // oxlint-disable-next-line vitest/max-expects -- all six checks establish the deployment namespace invariant.
    expect(addresses.map((address) => address.toLowerCase())).not.toContain(
      '0xeeeeeeee14d718c2b47d9923deab1335e144eeee',
    )
  })

  it('pins a nonzero runtime hash for every protocol address the tooling calls', () => {
    // oxlint-disable-next-line unicorn/no-array-sort -- the prescribed assertion compares sorted key sets.
    expect(Object.keys(ENS_RUNTIME_CODE_HASHES).sort()).toStrictEqual(
      [
        'DNSAliasResolver',
        'ETHRegistrar',
        'ETHRegistry',
        'MockUSDC',
        'RootRegistry',
        'UpgradableUniversalResolverProxy',
        'UserRegistryImpl',
        'VerifiableFactory',
        // oxlint-disable-next-line unicorn/no-array-sort -- the prescribed assertion compares sorted key sets.
      ].sort(),
    )
    for (const hash of Object.values(ENS_RUNTIME_CODE_HASHES)) {
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/u)
      expect(hash).not.toBe(`0x${'00'.repeat(32)}`)
    }
  })
})

describe('registry expiry conversion', () => {
  it('maps inclusive bounds to the earliest exclusive registry expiry', () => {
    expect(toRegistryExpiry([])).toBe(2n ** 64n - 1n)
    expect(toRegistryExpiry([0n, 500n, 300n])).toBe(301n)
    expect(() => toRegistryExpiry([2n ** 64n - 1n])).toThrow('finite validity bound')
  })
})
