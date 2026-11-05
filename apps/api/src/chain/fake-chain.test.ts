import { getAddress, verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

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

  it('checksums the signer and seeded addresses, whatever case they come in as', async () => {
    const lower = `0x${'ab'.repeat(20)}` as const
    const chain = new FakeChain({ signer: lower })
    expect(chain.signerAddress()).toBe(getAddress(lower))
    expect(new FakeChain().signerAddress()).toBe(getAddress(`0x${'f0'.repeat(20)}`))

    const uid = chain.seed({
      attester: lower,
      data: '0x',
      expirationTime: 0n,
      recipient: lower,
      refUID: ZERO_UID,
      revocable: true,
      revocationTime: 0n,
      schema,
      time: 0n,
    })
    const seeded = await chain.readAttestation(uid)
    expect(seeded.recipient).toBe(getAddress(lower))
    expect(seeded.attester).toBe(getAddress(lower))
  })

  it('checksums attested and factory-derived addresses', async () => {
    const lower = `0x${'ab'.repeat(20)}` as const
    const chain = new FakeChain({ signer: lower })
    const { uid } = await chain.attest({
      data: '0x',
      expirationTime: 0n,
      recipient: lower,
      refUID: ZERO_UID,
      revocable: true,
      schema,
    })
    const a = await chain.readAttestation(uid)
    expect(a.recipient).toBe(getAddress(lower))
    expect(a.attester).toBe(getAddress(lower))

    // getAddress is idempotent on a checksummed value and would rewrite a lowercase one.
    const factoryAddress = await chain.getAddressFromFactory([holder], 1n)
    expect(factoryAddress).toBe(getAddress(factoryAddress))
  })

  // Local D1 outlives the isolate that seeded it, so two FakeChains must not
  // hand out the same attestation uid and collide on members.attestation_uid.
  it('mints uids that differ between instances', async () => {
    const attest = async (chain: FakeChain) =>
      await chain.attest({
        data: '0x',
        expirationTime: 0n,
        recipient: holder,
        refUID: ZERO_UID,
        revocable: true,
        schema,
      })
    const first = await attest(new FakeChain())
    const second = await attest(new FakeChain())
    expect(first.uid).not.toBe(second.uid)
  })

  it('factory addresses are deterministic in owners + nonce', async () => {
    const chain = new FakeChain()
    const a = await chain.getAddressFromFactory([holder], 1n)
    expect(a).toBe(await chain.getAddressFromFactory([holder], 1n))
    expect(a).not.toBe(await chain.getAddressFromFactory([holder], 2n))
  })
})

describe('FakeChain tx hashes', () => {
  // A local dev restart builds a fresh FakeChain over a D1 file that survives it,
  // so two instances must not hand out the same tx hash.
  it('mints tx hashes that differ between instances', async () => {
    const root = `0x${'11'.repeat(32)}` as const
    const first = await new FakeChain().timestamp(root)
    const second = await new FakeChain().timestamp(root)
    expect(first.txHash).not.toBe(second.txHash)
  })
})

const KEY = `0x${'01'.repeat(32)}` as const

describe('FakeChain.verifyMessage', () => {
  it('checks smart-wallet signatures with the supplied verifier and preserves the challenge', async () => {
    const owner = privateKeyToAccount(KEY)
    const message = 'fuda.sh dashboard sign-in:local-challenge'
    const signature = await owner.signMessage({ message })
    // Model a contract wallet whose owner signs this challenge. The fallback
    // must receive the contract address and the original signed payload.
    const verifier = vi.fn<FakeChain['verifyMessage']>(async (input) =>
      input.address === holder
        ? await verifyMessage({ ...input, address: owner.address }).catch(() => false)
        : false,
    )
    const chain = new FakeChain({ verifyMessage: verifier })
    await expect(chain.verifyMessage({ address: holder, message, signature })).resolves.toBe(true)
    expect(verifier).toHaveBeenCalledWith({ address: holder, message, signature })
    await expect(
      chain.verifyMessage({ address: holder, message: `${message}:changed`, signature }),
    ).resolves.toBe(false)
    await expect(chain.verifyMessage({ address: holder, message, signature: '0x1234' })).resolves.toBe(false)
  })

  it('keeps valid EOA signatures offline even when a smart-wallet verifier is supplied', async () => {
    const owner = privateKeyToAccount(KEY)
    const signature = await owner.signMessage({ message: 'local' })
    const verifier = vi.fn<FakeChain['verifyMessage']>().mockRejectedValue(new ChainError('offline'))
    const chain = new FakeChain({ verifyMessage: verifier })
    await expect(chain.verifyMessage({ address: owner.address, message: 'local', signature })).resolves.toBe(
      true,
    )
    expect(verifier).not.toHaveBeenCalled()
    await expect(
      chain.verifyMessage({ address: holder, message: 'local', signature }),
    ).rejects.toBeInstanceOf(ChainError)
  })

  it('accepts a signature made by the holder key', async () => {
    const account = privateKeyToAccount(KEY)
    const signature = await account.signMessage({ message: 'fuda-gate:x:y' })
    const chain = new FakeChain()
    await expect(
      chain.verifyMessage({ address: account.address, message: 'fuda-gate:x:y', signature }),
    ).resolves.toBe(true)
  })

  it('rejects the same signature over a different message', async () => {
    const account = privateKeyToAccount(KEY)
    const signature = await account.signMessage({ message: 'fuda-gate:x:y' })
    const chain = new FakeChain()
    await expect(
      chain.verifyMessage({ address: account.address, message: 'fuda-gate:x:z', signature }),
    ).resolves.toBe(false)
  })

  it('rejects another key and a malformed signature without throwing', async () => {
    const account = privateKeyToAccount(KEY)
    const other = privateKeyToAccount(`0x${'02'.repeat(32)}`)
    const signature = await other.signMessage({ message: 'm' })
    const chain = new FakeChain()
    await expect(chain.verifyMessage({ address: account.address, message: 'm', signature })).resolves.toBe(
      false,
    )
    await expect(
      chain.verifyMessage({ address: account.address, message: 'm', signature: '0x1234' }),
    ).resolves.toBe(false)
    await expect(
      chain.verifyMessage({ address: account.address, message: 'm', signature: '0xdeadbeef' }),
    ).resolves.toBe(false)
  })

  it('throws ChainError when reads fail', async () => {
    const chain = new FakeChain()
    chain.failReads = true
    await expect(
      chain.verifyMessage({ address: `0x${'11'.repeat(20)}`, message: 'm', signature: '0x00' }),
    ).rejects.toBeInstanceOf(ChainError)
  })
})
