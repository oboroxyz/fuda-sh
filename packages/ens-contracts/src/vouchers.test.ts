import { hashTypedData } from 'viem'
import { describe, expect, it } from 'vitest'

import { claimVoucherTypedData, renewVoucherTypedData } from './index.ts'

const registrar = '0x1111111111111111111111111111111111111111' as const
const issuer = '0x2222222222222222222222222222222222222222' as const
const labelHash = `0x${'33'.repeat(32)}` as const

describe('voucher typed data', () => {
  // oxlint-disable-next-line unicorn/numeric-separators-style -- this fixed bigint vector is specified by the voucher contract.
  const input = { deadline: 2_000n, expiry: 3_000n, issuer, labelHash, nonce: 7n, registrar }

  it('separates claim and renew by primary type with the fixed domain', () => {
    const claim = claimVoucherTypedData(input)
    const renew = renewVoucherTypedData(input)
    expect(claim.domain).toStrictEqual({
      chainId: 11_155_111,
      name: 'FudaSubnameRegistrar',
      verifyingContract: registrar,
      version: '1',
    })
    expect(claim.primaryType).toBe('ClaimVoucher')
    expect(renew.primaryType).toBe('RenewVoucher')
    expect(hashTypedData(claim)).toBe('0x923f42654b9c0bb0dc3c49be040b9f72aeee1becad195ab14c3e0d389bc5724a')
    expect(hashTypedData(renew)).toBe('0xe36967dad4b6815e19ce53998015a1073a004dce72bf2ee3437c075bb98882f3')
  })
})
