import { FUDA_REGISTRAR_ABI } from '@fuda/ens-contracts'
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiParameters, toHex } from 'viem'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import { claimConfigFrom, confirmedClaim, signClaimVoucher } from './claim.ts'

const VOUCHER_KEY = `0x${'11'.repeat(32)}` as const
const REGISTRAR: Address = '0x58AF04ff5e6DAB45ECD17bD38fC4f4BBa45778B9'
const ISSUER: Address = '0x5A89D95Ad9f964C75F4Adc2122ADb70Cc6607Cd4'
const OTHER: Address = `0x${'99'.repeat(20)}`

const env = {
  ENS_GAS_POLICY_ID: 'policy-1',
  ENS_PARENT_NAME: 'fuda.eth',
  ENS_PAYMASTER_UPSTREAM: 'https://example.invalid/pm',
  ENS_REGISTRAR_ADDRESS: REGISTRAR,
  ENS_SEPOLIA_RPC_URL: 'https://example.invalid/rpc',
  ENS_VOUCHER_KEY: VOUCHER_KEY,
}

const claimedLog = (overrides: { address?: Address; issuer?: Address; label?: string } = {}) => {
  const labelHash = keccak256(toHex(overrides.label ?? 'bakery'))
  return {
    address: overrides.address ?? REGISTRAR,
    // `expiry` and `nonce` are the event's unindexed pair and travel in the data.
    data: encodeAbiParameters(parseAbiParameters('uint64 expiry,uint256 nonce'), [2000n, 0n]),
    topics: encodeEventTopics({
      abi: FUDA_REGISTRAR_ABI,
      args: { issuer: overrides.issuer ?? ISSUER, labelHash, tokenId: 1n },
      eventName: 'IssuerClaimed',
    }) as string[],
  }
}

describe(claimConfigFrom, () => {
  it('reads a complete configuration', () => {
    expect(claimConfigFrom(env)?.registrar).toBe(REGISTRAR)
  })

  it('is unconfigured while any single binding is missing', () => {
    const names = Object.keys(env)
    const partial = names.map((name) => ({ ...env, [name]: undefined }))

    expect(partial.map((each) => claimConfigFrom(each))).toStrictEqual(names.map(() => null))
  })
})

describe(signClaimVoucher, () => {
  it('signs a voucher the registrar’s own signer recovers', async () => {
    const config = claimConfigFrom(env)
    if (config === null) {
      throw new Error('configuration should be complete')
    }

    const voucher = await signClaimVoucher(config, {
      handle: 'bakery',
      issuer: ISSUER,
      nonce: 0n,
      now: 1000,
    })

    expect(voucher.signature).toMatch(/^0x[0-9a-f]{130}$/u)
    expect(voucher.deadline).toBeGreaterThan(1000)
    expect(voucher.expiry).toBeGreaterThan(voucher.deadline)
  })

  it('binds the signature to the label and the issuer', async () => {
    const config = claimConfigFrom(env)
    if (config === null) {
      throw new Error('configuration should be complete')
    }

    const [one, two, three] = await Promise.all([
      signClaimVoucher(config, { handle: 'bakery', issuer: ISSUER, nonce: 0n, now: 1000 }),
      signClaimVoucher(config, { handle: 'cafe', issuer: ISSUER, nonce: 0n, now: 1000 }),
      signClaimVoucher(config, { handle: 'bakery', issuer: OTHER, nonce: 0n, now: 1000 }),
    ])

    expect(new Set([one.signature, two.signature, three.signature]).size).toBe(3)
    expect(privateKeyToAccount(VOUCHER_KEY).address).toBe(config.voucherSigner)
  })
})

describe(confirmedClaim, () => {
  it('accepts the registrar’s own event for the expected label and issuer', () => {
    expect(confirmedClaim([claimedLog()], { handle: 'bakery', issuer: ISSUER, registrar: REGISTRAR })).toBe(
      true,
    )
  })

  it('rejects another contract, another label, and another issuer', () => {
    const check = (log: ReturnType<typeof claimedLog>) =>
      confirmedClaim([log], { handle: 'bakery', issuer: ISSUER, registrar: REGISTRAR })

    expect(check(claimedLog({ address: OTHER }))).toBe(false)
    expect(check(claimedLog({ label: 'cafe' }))).toBe(false)
    expect(check(claimedLog({ issuer: OTHER }))).toBe(false)
  })

  it('rejects a receipt with no claim in it', () => {
    expect(confirmedClaim([], { handle: 'bakery', issuer: ISSUER, registrar: REGISTRAR })).toBe(false)
  })

  it('ignores a log it cannot decode rather than throwing', () => {
    const undecodable = { address: REGISTRAR, data: '0x', topics: [`0x${'77'.repeat(32)}`] as string[] }

    expect(confirmedClaim([undecodable], { handle: 'bakery', issuer: ISSUER, registrar: REGISTRAR })).toBe(
      false,
    )
  })
})
