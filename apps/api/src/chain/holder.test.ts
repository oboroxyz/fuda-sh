import { keccak256, pad, toBytes } from 'viem'
import { describe, expect, it } from 'vitest'

import { FakeChain } from './fake-chain.ts'
import { bearerHolder } from './holder.ts'

describe(bearerHolder, () => {
  it('uses keccak(memberId) as nonce and the issuer padded to 32 bytes as the sole owner', async () => {
    const chain = new FakeChain()
    const issuer = `0x${'f0'.repeat(20)}` as const
    const expected = await chain.getAddressFromFactory(
      [pad(issuer, { size: 32 })],
      BigInt(keccak256(toBytes('alice'))),
    )
    await expect(bearerHolder(chain, issuer, 'alice')).resolves.toBe(expected)
    await expect(bearerHolder(chain, issuer, 'bob')).resolves.not.toBe(expected)
  })
})
