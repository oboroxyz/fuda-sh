import type { Address, Hex } from 'viem'

import { ENS_HACKATHON_CHAIN } from './deployment.ts'

export interface VoucherInput {
  deadline: bigint
  expiry: bigint
  issuer: Address
  labelHash: Hex
  nonce: bigint
  registrar: Address
}

export const toRegistryExpiry = (bounds: readonly bigint[]): bigint => {
  const finite = bounds.filter((bound) => bound !== 0n)
  // oxlint-disable-next-line curly -- the prescribed conversion keeps the empty case concise.
  if (finite.length === 0) return 2n ** 64n - 1n
  // oxlint-disable-next-line unicorn/no-array-reduce -- the prescribed conversion selects the earliest bound.
  const earliest = finite.reduce((left, right) => (left < right ? left : right))
  if (earliest < 0n || earliest >= 2n ** 64n - 1n) {
    throw new Error('finite validity bound must be between 0 and uint64 max - 1')
  }
  return earliest + 1n
}

const VOUCHER_FIELDS = [
  { name: 'labelHash', type: 'bytes32' },
  { name: 'issuer', type: 'address' },
  { name: 'expiry', type: 'uint64' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint64' },
] as const

const voucherDomain = (registrar: Address) =>
  ({
    chainId: ENS_HACKATHON_CHAIN.id,
    name: 'FudaSubnameRegistrar',
    verifyingContract: registrar,
    version: '1',
  }) as const

const voucherMessage = (input: VoucherInput) => ({
  deadline: input.deadline,
  expiry: input.expiry,
  issuer: input.issuer,
  labelHash: input.labelHash,
  nonce: input.nonce,
})

export const claimVoucherTypedData = (input: VoucherInput) =>
  ({
    domain: voucherDomain(input.registrar),
    message: voucherMessage(input),
    primaryType: 'ClaimVoucher',
    types: { ClaimVoucher: VOUCHER_FIELDS },
  }) as const

export const renewVoucherTypedData = (input: VoucherInput) =>
  ({
    domain: voucherDomain(input.registrar),
    message: voucherMessage(input),
    primaryType: 'RenewVoucher',
    types: { RenewVoucher: VOUCHER_FIELDS },
  }) as const
