import { custom, verifyTypedData } from 'viem'
import { describe, expect, it } from 'vitest'

import { testEnv } from '../../test/env.ts'
import {
  newOffchainMessage,
  offchainTypedData,
  offchainUid,
  toSignedJson,
  encodeOffchainPass,
} from '../eas/offchain.ts'
import { offchainDomain } from '../issue/issue-offchain.ts'
import { verifyOffchain } from '../verify/verify-offchain.ts'
import { ChainError, ZERO_UID } from './client.ts'
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

  it('exposes verifyMessage', () => {
    expect(createViemChain(testEnv()).verifyMessage).toBeTypeOf('function')
  })

  it('rejects a malformed address in the bindings', () => {
    expect(() => createViemChain(testEnv({ EAS_ADDRESS: 'not-an-address' }))).toThrow(ChainError)
  })
})

describe('configured attestation chain', () => {
  it.each([
    { expected: 84_532, value: undefined },
    { expected: 84_532, value: '84532' },
    { expected: 8453, value: '8453' },
  ])('reports $expected from CHAIN_ID=$value', ({ value, expected }) => {
    expect(createViemChain(testEnv({ CHAIN_ID: value })).chainId()).toBe(expected)
  })

  it('refuses an unknown chain at construction', () => {
    expect(() => createViemChain(testEnv({ CHAIN_ID: '1' }))).toThrow('Unsupported CHAIN_ID')
  })

  it.each([
    ['8453', '84532'],
    ['84532', '8453'],
  ])('rejects a signature from chain %s on chain %s', async (source, target) => {
    const bindings = testEnv({ SIGNER_PRIVATE_KEY: `0x${'11'.repeat(32)}` })
    const offline = custom({
      request: async () => await Promise.reject(new Error('Domain verification must not use RPC')),
    })
    const signing = createViemChain({ ...bindings, CHAIN_ID: source }, offline)
    const accepting = createViemChain({ ...bindings, CHAIN_ID: target }, offline)
    const domain = offchainDomain(bindings, signing)
    const otherDomain = offchainDomain(bindings, accepting)
    const attester = signing.offchainAttester()
    if (domain === null || otherDomain === null || attester === null) {
      throw new Error('Signing configuration is missing')
    }
    const message = newOffchainMessage({
      data: encodeOffchainPass({
        card: 'card',
        holderKey: '0x',
        level: 0,
        memberNumber: '1',
        tier: 0,
        usageModel: 0,
        validFrom: 0n,
        validUntil: 0n,
        venue: 'shop',
      }),
      expirationTime: 0n,
      refUID: ZERO_UID,
      time: 1n,
    })
    const signature = await signing.signOffchain(offchainTypedData(domain, message))
    await expect(
      verifyTypedData({ ...offchainTypedData(domain, message), address: attester, signature }),
    ).resolves.toBe(true)
    await expect(
      verifyTypedData({ ...offchainTypedData(otherDomain, message), address: attester, signature }),
    ).resolves.toBe(false)
    const uid = offchainUid(message)
    await expect(
      verifyOffchain({ chain: accepting, domain: otherDomain, now: 2, retiredSigners: [] }, uid, {
        cardId: 'card',
        handle: 'shop',
        signed: toSignedJson({ domain, message, signature, uid }),
        status: 'active',
      }),
    ).resolves.toMatchObject({ decision: 'REJECT', reason: 'BAD_SIGNATURE' })
  })
})
