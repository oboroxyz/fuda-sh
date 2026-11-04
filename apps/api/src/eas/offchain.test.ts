import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  decodeOffchainPass,
  encodeOffchainPass,
  fromSignedJson,
  newOffchainMessage,
  offchainTypedData,
  offchainUid,
  recoverOffchainSigner,
  toSignedJson,
} from './offchain.ts'
import type { OffchainDomain, OffchainMessage } from './offchain.ts'

const DOMAIN: OffchainDomain = {
  chainId: 84_532,
  name: 'EAS Attestation',
  verifyingContract: '0x4200000000000000000000000000000000000021',
  version: '1.4.1-beta.3',
}

// Produced by @ethereum-attestation-service/eas-sdk 2.10.0 (Offchain,
// OffchainAttestationVersion.Version2), so this pins compatibility with what EAS
// tooling reads. The sdk stays out of the Worker; only its output is copied here.
const SDK_KEY: Hex = `0x${'ab'.repeat(32)}`
const SDK_MESSAGE: OffchainMessage = {
  data: '0x1234',
  expirationTime: 2_000_000_000n,
  recipient: `0x${'00'.repeat(20)}`,
  refUID: `0x${'00'.repeat(32)}`,
  revocable: true,
  salt: `0x${'22'.repeat(32)}`,
  schema: `0x${'11'.repeat(32)}`,
  time: 1_757_000_000n,
  version: 2,
}
const SDK_UID: Hex = '0x1d48c9516d778b3b67bf6d58cfd6c36245df8435caaca1308d35cd44421b817f'
const SDK_R = '36c2fac20a11c174a47952ae082db1c090316dd0895d795073fefd2f6e021847'
const SDK_S = '460133cfe8ff5ed0039eae445eaf450937d26fe6444f30ea1a0e21c48e9d7cb8'

describe('offchain attestations', () => {
  it('derives the same uid as the EAS sdk', () => {
    expect(offchainUid(SDK_MESSAGE)).toBe(SDK_UID)
  })

  it('signs exactly what the EAS sdk signs', async () => {
    const account = privateKeyToAccount(SDK_KEY)
    const signature = await account.signTypedData(offchainTypedData(DOMAIN, SDK_MESSAGE))
    expect(signature.slice(2, 66)).toBe(SDK_R)
    expect(signature.slice(66, 130)).toBe(SDK_S)
  })

  it('recovers the signer after a round trip through JSON', async () => {
    const account = privateKeyToAccount(SDK_KEY)
    const signature = await account.signTypedData(offchainTypedData(DOMAIN, SDK_MESSAGE))
    const stored = toSignedJson({ domain: DOMAIN, message: SDK_MESSAGE, signature, uid: SDK_UID })
    const loaded = fromSignedJson(stored)
    expect(loaded?.message.time).toBe(SDK_MESSAGE.time)
    if (loaded === null) {
      throw new Error('stored attestation did not parse')
    }
    await expect(recoverOffchainSigner(loaded)).resolves.toBe(account.address)
  })

  it('recovers a different signer for altered data', async () => {
    const account = privateKeyToAccount(SDK_KEY)
    const signature = await account.signTypedData(offchainTypedData(DOMAIN, SDK_MESSAGE))
    const altered = { ...SDK_MESSAGE, data: '0x9999' as const }
    await expect(
      recoverOffchainSigner({ domain: DOMAIN, message: altered, signature, uid: SDK_UID }),
    ).resolves.not.toBe(account.address)
  })

  it('answers null for a stored row that does not parse', () => {
    expect(fromSignedJson('not json')).toBeNull()
    expect(fromSignedJson('{"uid":"0x12"}')).toBeNull()
  })

  it('gives every message its own salt', () => {
    const input = { data: '0x' as const, expirationTime: 0n, refUID: SDK_MESSAGE.refUID, time: 1n }
    expect(newOffchainMessage(input).salt).not.toBe(newOffchainMessage(input).salt)
  })

  it('keeps the pass fields through encoding', () => {
    const pass = {
      card: 'card-1',
      holderKey: '0x' as const,
      level: 0,
      memberNumber: 'ABCD',
      tier: 0,
      usageModel: 1,
      validFrom: 0n,
      validUntil: 5n,
      venue: 'wassie-coffee',
    }
    expect(decodeOffchainPass(encodeOffchainPass(pass))).toStrictEqual(pass)
  })
})
