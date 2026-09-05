import { describe, expect, it } from 'vitest'

import { ChainError, NoSignerError, ZERO_UID } from './client.ts'
import { FakeChain } from './fake-chain.ts'

const schema = `0x${'aa'.repeat(32)}` as const
const holder = `0x${'11'.repeat(20)}` as const

describe(FakeChain, () => {
  it('attests, reads back, and reports unknown uids as zero', async () => {
    const chain = new FakeChain()
    const { uid } = await chain.attest({
      data: '0x',
      expirationTime: 0n,
      recipient: holder,
      refUID: ZERO_UID,
      revocable: true,
      schema,
    })
    const a = await chain.readAttestation(uid)
    expect(a.uid).toBe(uid)
    expect(a.recipient).toBe(holder)
    expect(a.attester).toBe(chain.signerAddress())
    expect(a.revocationTime).toBe(0n)
    const unknown = await chain.readAttestation(`0x${'ee'.repeat(32)}`)
    expect(unknown.uid).toBe(ZERO_UID)
  })

  it('revoke sets revocationTime; revoking twice or an unknown uid throws ChainError', async () => {
    const chain = new FakeChain()
    const { uid } = await chain.attest({
      data: '0x',
      expirationTime: 0n,
      recipient: holder,
      refUID: ZERO_UID,
      revocable: true,
      schema,
    })
    await chain.revoke(schema, uid)
    const revoked = await chain.readAttestation(uid)
    expect(revoked.revocationTime).toBeGreaterThan(0n)
    await expect(chain.revoke(schema, uid)).rejects.toBeInstanceOf(ChainError)
    await expect(chain.revoke(schema, `0x${'ee'.repeat(32)}`)).rejects.toBeInstanceOf(ChainError)
  })

  it('throws NoSignerError on writes without a signer, ChainError when failing is forced', async () => {
    const noSigner = new FakeChain({ signer: null })
    await expect(
      noSigner.attest({
        data: '0x',
        expirationTime: 0n,
        recipient: holder,
        refUID: ZERO_UID,
        revocable: true,
        schema,
      }),
    ).rejects.toBeInstanceOf(NoSignerError)
    const flaky = new FakeChain()
    flaky.failReads = true
    await expect(flaky.readAttestation(ZERO_UID)).rejects.toBeInstanceOf(ChainError)
  })

  it('factory addresses are deterministic in owners + nonce', async () => {
    const chain = new FakeChain()
    const a = await chain.getAddressFromFactory([holder], 1n)
    expect(a).toBe(await chain.getAddressFromFactory([holder], 1n))
    expect(a).not.toBe(await chain.getAddressFromFactory([holder], 2n))
  })
})
