import { describe, expect, it } from 'vitest'

import { FakeChain } from '../src/chain/fake-chain.ts'
import { buildChain, isFakeChainEnabled } from '../src/index.ts'
import type { DevBindings } from '../src/index.ts'
import { testEnv } from './env.ts'

describe(isFakeChainEnabled, () => {
  it('opts in only when USE_FAKE_CHAIN=1 and no signer or RPC is configured', () => {
    expect(isFakeChainEnabled({ USE_FAKE_CHAIN: '1' })).toBeTruthy()
    expect(isFakeChainEnabled({ SIGNER_PRIVATE_KEY: '0xabc', USE_FAKE_CHAIN: '1' })).toBeFalsy()
    expect(isFakeChainEnabled({ BASE_RPC_URL: 'https://example.test', USE_FAKE_CHAIN: '1' })).toBeFalsy()
    expect(isFakeChainEnabled({})).toBeFalsy()
  })
})

describe(buildChain, () => {
  it('builds a FakeChain under the opt-in and a viem chain otherwise', () => {
    const fakeEnv: DevBindings = {
      ...testEnv({ BASE_RPC_URL: undefined, SIGNER_PRIVATE_KEY: undefined }),
      USE_FAKE_CHAIN: '1',
    }
    expect(buildChain(fakeEnv)).toBeInstanceOf(FakeChain)

    const realEnv: DevBindings = testEnv()
    expect(buildChain(realEnv)).not.toBeInstanceOf(FakeChain)
  })
})
