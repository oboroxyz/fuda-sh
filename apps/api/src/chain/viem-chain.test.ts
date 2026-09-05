import { describe, expect, it } from 'vitest'

import { testEnv } from '../../test/env.ts'
import { ChainError } from './client.ts'
import { createViemChain } from './viem-chain.ts'

// Construction only — no RPC call is made by createPublicClient/http.
// The live path is covered by the manual Base Sepolia smoke.
describe(createViemChain, () => {
  it('reports no signer when SIGNER_PRIVATE_KEY is unset', () => {
    expect(createViemChain(testEnv()).signerAddress()).toBeNull()
  })

  it('derives the signer address from SIGNER_PRIVATE_KEY', () => {
    const chain = createViemChain(testEnv({ SIGNER_PRIVATE_KEY: `0x${'11'.repeat(32)}` }))
    expect(chain.signerAddress()).toBe('0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A')
  })

  it('rejects a malformed address in the bindings', () => {
    expect(() => createViemChain(testEnv({ EAS_ADDRESS: 'not-an-address' }))).toThrow(ChainError)
  })
})
