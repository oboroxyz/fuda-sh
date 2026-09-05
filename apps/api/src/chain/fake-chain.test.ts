import { getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
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

describe('FakeChain announcements', () => {
  const p = {
    ephemeralPubKey: `0x02${'11'.repeat(32)}`,
    metadata: `0x1f${'ab'.repeat(32)}`,
    stealthAddress: `0x${'22'.repeat(20)}`,
  } as const

  it('records an announcement with an increasing block number and the signer as caller', async () => {
    const chain = new FakeChain({ head: 100 })
    const a = await chain.announce(p)
    const b = await chain.announce({ ...p, metadata: `0x20${'ab'.repeat(32)}` })
    expect(a.txHash).not.toBe(b.txHash)
    expect(chain.announcements.map((l) => l.blockNumber)).toStrictEqual([101, 102])
    expect(chain.announcements[0]).toMatchObject({
      caller: chain.signerAddress(),
      logIndex: 0,
      schemeId: 1,
    })
  })

  it('serves logs by inclusive block range and reports the head', async () => {
    const chain = new FakeChain({ head: 100 })
    await chain.announce(p)
    await chain.announce(p)
    await chain.announce(p)
    const inRange = await chain.getAnnouncementLogs(102, 103)
    const beyondHead = await chain.getAnnouncementLogs(104, 200)
    await expect(chain.blockNumber()).resolves.toBe(103)
    expect(inRange.map((l) => l.blockNumber)).toStrictEqual([102, 103])
    expect(beyondHead).toStrictEqual([])
  })

  it('starts the head at the current unix time so a stale persisted cursor can never outrun it', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const chain = new FakeChain()
    const startHead = await chain.blockNumber()
    expect(startHead).toBeGreaterThanOrEqual(nowSeconds)
    const a = await chain.announce(p)
    const b = await chain.announce({ ...p, metadata: `0x20${'ab'.repeat(32)}` })
    expect(a.txHash).not.toBe(b.txHash)
    const [first, second] = chain.announcements.map((l) => l.blockNumber)
    expect(second).toBe((first ?? 0) + 1)
  })

  it('stores the announced bytes lower-cased and the stealth address checksummed, as viem decodes them', async () => {
    const chain = new FakeChain({ head: 100 })
    await chain.announce({
      ephemeralPubKey: `0x02${'AB'.repeat(32)}`,
      metadata: `0x1F${'CD'.repeat(32)}`,
      stealthAddress: `0x${'22'.repeat(20)}`,
    })
    expect(chain.announcements[0]?.ephemeralPubKey).toBe(`0x02${'ab'.repeat(32)}`)
    expect(chain.announcements[0]?.metadata).toBe(`0x1f${'cd'.repeat(32)}`)
    expect(chain.announcements[0]?.stealthAddress).toBe(getAddress(`0x${'22'.repeat(20)}`))
  })

  it('fails announce independently of attest', async () => {
    const chain = new FakeChain()
    chain.failAnnounce = true
    await expect(chain.announce(p)).rejects.toBeInstanceOf(ChainError)
    chain.failAnnounce = false
    chain.failWrites = true
    await expect(chain.announce(p)).resolves.toHaveProperty('txHash')
    chain.failReads = true
    await expect(chain.getAnnouncementLogs(0, 10)).rejects.toBeInstanceOf(ChainError)
    await expect(chain.blockNumber()).rejects.toBeInstanceOf(ChainError)
  })

  it('needs a signer to announce', async () => {
    await expect(new FakeChain({ signer: null }).announce(p)).rejects.toBeInstanceOf(NoSignerError)
  })
})

const KEY = `0x${'01'.repeat(32)}` as const

describe('FakeChain.verifyMessage', () => {
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
