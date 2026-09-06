import { describe, expect, it } from 'vitest'

import { DEV_DELEGATION_UID, FakeChain } from '../src/chain/fake-chain.ts'
import { decodeDelegation } from '../src/eas/codecs.ts'
import { buildChain, isFakeChainEnabled, schemaSetsOf } from '../src/index.ts'
import type { DevBindings } from '../src/index.ts'
import { testEnv } from './env.ts'
import { ATT } from './fixtures.ts'

describe(isFakeChainEnabled, () => {
  it('opts in only when USE_FAKE_CHAIN=1 and no signer or RPC is configured', () => {
    expect(isFakeChainEnabled({ USE_FAKE_CHAIN: '1' })).toBe(true)
    expect(isFakeChainEnabled({ SIGNER_PRIVATE_KEY: '0xabc', USE_FAKE_CHAIN: '1' })).toBe(false)
    expect(isFakeChainEnabled({ BASE_RPC_URL: 'https://example.test', USE_FAKE_CHAIN: '1' })).toBe(false)
    expect(isFakeChainEnabled({})).toBe(false)
  })
})

describe(buildChain, () => {
  it('builds a FakeChain under the opt-in and a viem chain otherwise', () => {
    // testEnv() strips the opt-in that `.dev.vars` may carry, so this case sets it.
    const fakeEnv: DevBindings = { ...testEnv(), USE_FAKE_CHAIN: '1' }
    expect(buildChain(fakeEnv)).toBeInstanceOf(FakeChain)

    const realEnv: DevBindings = testEnv()
    expect(buildChain(realEnv)).not.toBeInstanceOf(FakeChain)
  })

  it('seeds the dev root delegation at the fixed uid wrangler.jsonc pins, not a random one', async () => {
    // Pinned literally (not read from wrangler.jsonc) so a change to either side
    // of this pairing is a deliberate, visible edit rather than a tautology.
    expect(DEV_DELEGATION_UID).toBe('0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6')

    const fakeEnv: DevBindings = { ...testEnv(), USE_FAKE_CHAIN: '1' }
    const chain = buildChain(fakeEnv)
    expect(chain).toBeInstanceOf(FakeChain)

    const delegation = await chain.readAttestation(DEV_DELEGATION_UID)
    expect(delegation.uid.toLowerCase()).toBe(DEV_DELEGATION_UID.toLowerCase())
    expect(delegation.revocationTime).toBe(0n)
    expect(decodeDelegation(1, delegation.data).active).toBe(true)
  })
})

describe(schemaSetsOf, () => {
  it('parses the binding and degrades a malformed one to empty sets', () => {
    const good = JSON.stringify({
      attendance: [{ uid: ATT, version: 1 }],
      entitlement: [],
      issuerDelegation: [],
    })
    expect(schemaSetsOf({ EAS_SCHEMAS: good }).attendance).toStrictEqual([{ uid: ATT, version: 1 }])
    expect(schemaSetsOf({ EAS_SCHEMAS: 'not json' })).toStrictEqual({
      attendance: [],
      entitlement: [],
      issuerDelegation: [],
    })
  })
})
