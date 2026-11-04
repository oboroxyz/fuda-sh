import { challengeMessage } from '@fuda/sdk'
import type { ChallengeResponse, Hex, VerifySignedResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

import { displayOf, enterSigned, enterWithPasskey } from './signed-gate.ts'
import type { PasskeyGateIo, SignedGateIo } from './signed-gate.ts'

const account = privateKeyToAccount(`0x${'5a'.repeat(32)}`)
const UID: Hex = `0x${'ab'.repeat(32)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`
const SIGNATURE: Hex = `0x${'11'.repeat(65)}`

const minted: Result<ChallengeResponse> = {
  body: { challenge: challengeMessage(UID, NONCE), nonce: NONCE },
  ok: true,
}

// Only the io boundary is faked: `sign` is a real local account, so the test
// exercises the exact bytes a wallet would put its signature over.
const io = (verify: SignedGateIo['verify']): SignedGateIo => ({
  challenge: async () => await Promise.resolve(minted),
  sign: async (message) => await account.signMessage({ message }),
  verify,
})

describe(enterSigned, () => {
  it('does not sign when its screen leaves while the challenge is pending', async () => {
    const pending = Promise.withResolvers<Result<ChallengeResponse>>()
    const abort = new AbortController()
    const sign = vi.fn<SignedGateIo['sign']>(async () => await Promise.resolve('0x00'))
    const verify = vi.fn<SignedGateIo['verify']>(
      async () =>
        await Promise.resolve({
          body: { decision: 'ADMIT', holder: account.address, path: 'signature', reason: 'OK' },
          ok: true,
        }),
    )
    const result = enterSigned(
      { challenge: async () => await pending.promise, sign, verify },
      UID,
      abort.signal,
    )

    abort.abort()
    pending.resolve(minted)

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(sign).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })

  it('does not verify when its screen leaves while signing is pending', async () => {
    const pending = Promise.withResolvers<Hex>()
    const abort = new AbortController()
    const verify = vi.fn<SignedGateIo['verify']>(
      async () =>
        await Promise.resolve({
          body: { decision: 'ADMIT', holder: account.address, path: 'signature', reason: 'OK' },
          ok: true,
        }),
    )
    const result = enterSigned(
      {
        challenge: async () => await Promise.resolve(minted),
        sign: async () => await pending.promise,
        verify,
      },
      UID,
      abort.signal,
    )
    await Promise.resolve()

    abort.abort()
    pending.resolve('0x00')

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('signs exactly the challenge string and posts uid, nonce and signature', async () => {
    const seen: Parameters<SignedGateIo['verify']>[0][] = []
    const result = await enterSigned(
      io(async (body) => {
        seen.push(body)
        return await Promise.resolve({
          body: { decision: 'ADMIT', holder: account.address, path: 'signature', reason: 'OK' },
          ok: true,
        })
      }),
      UID,
    )
    expect(result).toMatchObject({ body: { decision: 'ADMIT' }, kind: 'verdict' })
    expect(seen[0]).toMatchObject({ nonce: NONCE, uid: UID })
    const posted = seen[0]?.signature ?? '0x'
    // The api verifies EIP-191 over the challenge string (docs/specs/attestation-model.md#wire-constants); this is that check,
    // run purely, against the signature the flow actually produced.
    await expect(
      verifyMessage({
        address: account.address,
        message: challengeMessage(UID, NONCE),
        signature: posted,
      }),
    ).resolves.toBe(true)
  })

  it('reports a challenge failure without signing', async () => {
    let signed = false
    const result = await enterSigned(
      {
        challenge: async () =>
          await Promise.resolve({ error: 'api 502', network: true, ok: false, status: 502 }),
        sign: async () => {
          signed = true
          return await Promise.resolve('0x00')
        },
        verify: async () =>
          await Promise.resolve({ error: 'unreachable', network: true, ok: false, status: 0 }),
      },
      UID,
    )
    expect(result).toStrictEqual({ error: 'api 502', kind: 'error', network: true })
    expect(signed).toBe(false)
  })

  it('reports a signing refusal as a non-network error', async () => {
    const result = await enterSigned(
      {
        ...io(async () => await Promise.resolve({ error: 'x', network: false, ok: false, status: 400 })),
        sign: async () => await Promise.reject(new Error('User rejected')),
      },
      UID,
    )
    expect(result).toStrictEqual({ error: 'User rejected', kind: 'error', network: false })
  })

  it('surfaces a verify failure with its network flag', async () => {
    const result = await enterSigned(
      io(async () => await Promise.resolve({ error: 'api 503', network: true, ok: false, status: 503 })),
      UID,
    )
    expect(result).toStrictEqual({ error: 'api 503', kind: 'error', network: true })
  })

  it('returns the REJECT verdict as a verdict, not an error', async () => {
    const body: VerifySignedResponse = {
      decision: 'REJECT',
      path: 'signature',
      reason: 'BAD_CHALLENGE',
      stage: 'challenge',
    }
    const result = await enterSigned(
      io(async () => await Promise.resolve({ body, ok: true })),
      UID,
    )
    expect(result).toStrictEqual({ body, kind: 'verdict' })
  })
})

const verdict = (body: VerifySignedResponse) => displayOf({ body, kind: 'verdict' })

describe(displayOf, () => {
  it('is green on ADMIT and red with the reason on REJECT', () => {
    expect(
      verdict({ decision: 'ADMIT', holder: account.address, path: 'signature', reason: 'OK' }),
    ).toMatchObject({ title: 'ADMIT', tone: 'green' })
    expect(
      verdict({ decision: 'REJECT', path: 'signature', reason: 'BAD_CHALLENGE', stage: 'challenge' }),
    ).toMatchObject({ detail: 'BAD_CHALLENGE', title: 'REJECT', tone: 'red' })
  })

  it('shows the network banner only for network errors', () => {
    expect(displayOf({ error: 'x', kind: 'error', network: true })).toMatchObject({
      banner: 'network',
      tone: 'red',
    })
    expect(displayOf({ error: 'x', kind: 'error', network: false })).not.toHaveProperty('banner')
  })
})

describe(enterWithPasskey, () => {
  const webauthn = { challenge: 'Zm9v', rpId: 'fuda.sh', userVerification: 'required' } as const
  const assertion = {
    clientExtensionResults: {},
    id: 'abc',
    rawId: 'abc',
    response: { authenticatorData: 'YQ', clientDataJSON: 'YQ', signature: 'YQ' },
    type: 'public-key',
  } as const
  const passkeyIo = (over: Partial<PasskeyGateIo> = {}): PasskeyGateIo => ({
    assert: async () => await Promise.resolve(assertion),
    challenge: async () =>
      await Promise.resolve({ body: { challenge: 'x', nonce: NONCE, webauthn }, ok: true }),
    signForPass: async () => await Promise.resolve(SIGNATURE),
    verify: async () =>
      await Promise.resolve({
        body: { decision: 'ADMIT', holder: `0x${'00'.repeat(20)}`, path: 'signature', reason: 'OK' },
        ok: true,
      }),
    ...over,
  })

  it('answers a Sensitive pass, which names no passkey, with the key of that pass', async () => {
    const assert = vi.fn<PasskeyGateIo['assert']>()
    const signForPass = vi.fn<PasskeyGateIo['signForPass']>(async () => await Promise.resolve(SIGNATURE))
    const verify = vi.fn<PasskeyGateIo['verify']>(
      async () =>
        await Promise.resolve({
          body: { decision: 'ADMIT', holder: `0x${'00'.repeat(20)}`, path: 'signature', reason: 'OK' },
          ok: true,
        }),
    )
    const outcome = await enterWithPasskey(
      passkeyIo({
        assert,
        challenge: async () => await Promise.resolve({ body: { challenge: 'x', nonce: NONCE }, ok: true }),
        signForPass,
        verify,
      }),
      UID,
    )
    expect(outcome.kind).toBe('verdict')
    expect(assert).not.toHaveBeenCalled()
    expect(signForPass).toHaveBeenCalledWith(UID, 'x')
    expect(verify).toHaveBeenCalledWith({ nonce: NONCE, signature: SIGNATURE, uid: UID })
  })

  it('answers the request the api minted and sends back that nonce', async () => {
    const assert = vi.fn<PasskeyGateIo['assert']>(async () => await Promise.resolve(assertion))
    const verify = vi.fn<PasskeyGateIo['verify']>(passkeyIo().verify)
    const outcome = await enterWithPasskey(passkeyIo({ assert, verify }), UID)

    expect(assert).toHaveBeenCalledWith(webauthn)
    expect(verify).toHaveBeenCalledWith({ nonce: NONCE, uid: UID, webauthn: assertion })
    expect(displayOf(outcome)).toStrictEqual({ detail: '', title: 'ADMIT', tone: 'green' })
  })

  it('reads a dismissed prompt as a refusal, not an outage', async () => {
    const outcome = await enterWithPasskey(
      passkeyIo({
        assert: async () => await Promise.reject(new DOMException('dismissed', 'NotAllowedError')),
      }),
      UID,
    )
    expect(outcome).toStrictEqual({ error: 'dismissed', kind: 'error', network: false })
  })
})

describe('venue context on signed entry', () => {
  it('carries the requested venue through challenge and verification', async () => {
    const challenge = vi.fn<SignedGateIo['challenge']>(async () => await Promise.resolve(minted))
    const verify = vi.fn<SignedGateIo['verify']>(
      async () =>
        await Promise.resolve({
          body: { decision: 'ADMIT', path: 'signature', reason: 'OK', venue: 'coffee' },
          ok: true,
        }),
    )
    await enterSigned({ ...io(verify), challenge }, UID, undefined, 'coffee')
    expect(challenge).toHaveBeenCalledWith(UID, 'coffee')
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ uid: UID, venue: 'coffee' }))
    expect(
      displayOf({
        body: { decision: 'ADMIT', path: 'signature', reason: 'OK', venue: 'coffee' },
        kind: 'verdict',
      }),
    ).toMatchObject({ title: 'ADMIT', venue: 'coffee' })
  })
})
