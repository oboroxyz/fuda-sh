import { challengeMessage } from '@fuda/sdk'
import type { ChallengeResponse, Hex } from '@fuda/sdk'
import { buildAnnouncementMetadata, generateStealthAddress } from '@fuda/stealth'
import type { GeneratedStealthAddress } from '@fuda/stealth'
import type { Result } from '@fuda/ui'
import { verifyMessage } from 'viem'
import { describe, expect, it } from 'vitest'

import { discover, keysFromPrf, stealthSigner } from './private-member.ts'
import type { AnnouncementDto } from './private-member.ts'
import { enterSigned } from './signed-gate.ts'
import type { SignedGateIo } from './signed-gate.ts'

const PRF = new Uint8Array(32).fill(42)
const UID: Hex = `0x${'ab'.repeat(32)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`

const row = (g: GeneratedStealthAddress, uid: Hex, block: number): AnnouncementDto => ({
  blockNumber: block,
  caller: `0x${'00'.repeat(20)}`,
  ephemeralPubKey: g.ephemeralPublicKey,
  logIndex: 0,
  metadata: buildAnnouncementMetadata(g.viewTag, uid),
  schemeId: 1,
  stealthAddress: g.stealthAddress,
  txHash: `0x${block.toString(16).padStart(64, '0')}`,
})

describe(keysFromPrf, () => {
  it('is deterministic per PRF output and yields a 66-byte meta-address', () => {
    const a = keysFromPrf(PRF)
    const b = keysFromPrf(new Uint8Array(32).fill(42))
    expect(a.metaAddress).toBe(b.metaAddress)
    expect(a.metaAddress).toMatch(/^0x[0-9a-f]{132}$/u)
  })
})

describe(discover, () => {
  it('finds the passes announced to this member and ignores the rest', () => {
    const keys = keysFromPrf(PRF)
    const stranger = keysFromPrf(new Uint8Array(32).fill(1))
    const mine = generateStealthAddress(keys.metaAddress)
    const theirs = generateStealthAddress(stranger.metaAddress)
    const found = discover(keys, [row(theirs, `0x${'11'.repeat(32)}`, 1), row(mine, UID, 2)])
    expect(found.map((f) => f.uid)).toStrictEqual([UID])
  })
})

// The whole member-side path: derive → (sender) generate → recover → sign →
// the api's pure check against the stealth address.
const discoverOne = () => {
  const keys = keysFromPrf(PRF)
  const g = generateStealthAddress(keys.metaAddress)
  const [pass] = discover(keys, [row(g, UID, 1)])
  return { pass, stealthAddress: g.stealthAddress }
}

describe(stealthSigner, () => {
  it('signs the challenge with a key the stealth address controls', async () => {
    const { pass, stealthAddress } = discoverOne()
    expect(pass).toBeDefined()
    const message = challengeMessage(UID, NONCE)
    const signature = await stealthSigner(pass ?? { stealthAddress, stealthPrivateKey: '0x', uid: UID })(
      message,
    )
    await expect(verifyMessage({ address: stealthAddress, message, signature })).resolves.toBe(true)
  })

  // +Private is Signed with a derived key: the existing gate flow is reused
  // whole, with the stealth signer standing in for the wallet.
  it('drives enterSigned end to end against a mocked api', async () => {
    const { pass, stealthAddress } = discoverOne()
    const minted: Result<ChallengeResponse> = {
      body: { challenge: challengeMessage(UID, NONCE), nonce: NONCE },
      ok: true,
    }
    const seen: Parameters<SignedGateIo['verify']>[0][] = []
    const outcome = await enterSigned(
      {
        challenge: async () => await Promise.resolve(minted),
        sign: stealthSigner(pass ?? { stealthAddress, stealthPrivateKey: '0x', uid: UID }),
        verify: async (body) => {
          seen.push(body)
          return await Promise.resolve({
            body: { decision: 'ADMIT', holder: stealthAddress, path: 'signature', reason: 'OK' },
            ok: true,
          })
        },
      },
      UID,
    )
    expect(outcome).toMatchObject({ body: { decision: 'ADMIT' }, kind: 'verdict' })
    expect(seen[0]).toMatchObject({ nonce: NONCE, uid: UID })
    await expect(
      verifyMessage({
        address: stealthAddress,
        message: challengeMessage(UID, NONCE),
        signature: seen[0]?.signature ?? '0x',
      }),
    ).resolves.toBe(true)
  })
})
