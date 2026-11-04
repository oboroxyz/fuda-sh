import { hasNoHolder } from '@fuda/sdk'
import type { ChallengeResponse, Hex, PasskeyRequestOptions, VerifySignedResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'

export interface SignedGateIo {
  challenge: (uid: Hex) => Promise<Result<ChallengeResponse>>
  sign: (message: string) => Promise<Hex>
  verify: (body: { uid: Hex; nonce: Hex; signature: Hex }) => Promise<Result<VerifySignedResponse>>
}

export interface PasskeyGateIo {
  assert: (options: PasskeyRequestOptions) => Promise<AuthenticationResponseJSON>
  challenge: SignedGateIo['challenge']
  verify: (body: {
    uid: Hex
    nonce: Hex
    webauthn: AuthenticationResponseJSON
  }) => Promise<Result<VerifySignedResponse>>
}

export type SignedOutcome =
  | { kind: 'verdict'; body: VerifySignedResponse }
  | { kind: 'error'; error: string; network: boolean }

// The member-side flow (docs/specs/pass-types-and-flows.md#gate-protocol): mint → answer
// what the api minted, byte for byte → verify. Nothing here reconstructs the message.
const enter = async <Proof>(
  io: {
    challenge: SignedGateIo['challenge']
    prove: (minted: ChallengeResponse) => Promise<Proof>
    verify: (nonce: Hex, proof: Proof) => Promise<Result<VerifySignedResponse>>
  },
  uid: Hex,
  signal?: AbortSignal,
): Promise<SignedOutcome> => {
  signal?.throwIfAborted()
  const minted = await io.challenge(uid)
  signal?.throwIfAborted()
  if (!minted.ok) {
    return { error: minted.error, kind: 'error', network: minted.network }
  }
  let proof: Proof
  try {
    proof = await io.prove(minted.body)
  } catch (error) {
    signal?.throwIfAborted()
    // A refused prompt is the member's own choice, not an outage: no network banner.
    return {
      error: error instanceof Error ? error.message : 'signing failed',
      kind: 'error',
      network: false,
    }
  }
  signal?.throwIfAborted()
  const verified = await io.verify(minted.body.nonce, proof)
  signal?.throwIfAborted()
  if (!verified.ok) {
    return { error: verified.error, kind: 'error', network: verified.network }
  }
  return { body: verified.body, kind: 'verdict' }
}

export const enterSigned = async (io: SignedGateIo, uid: Hex, signal?: AbortSignal): Promise<SignedOutcome> =>
  await enter(
    {
      challenge: io.challenge,
      prove: async (minted) => await io.sign(minted.challenge),
      verify: async (nonce, signature) => await io.verify({ nonce, signature, uid }),
    },
    uid,
    signal,
  )

// An Identified pass answers with the passkey it attests, which the api names when it mints.
export const enterWithPasskey = async (
  io: PasskeyGateIo,
  uid: Hex,
  signal?: AbortSignal,
): Promise<SignedOutcome> =>
  await enter(
    {
      challenge: io.challenge,
      prove: async ({ webauthn }) => {
        if (webauthn === undefined) {
          throw new Error('This pass has no passkey.')
        }
        return await io.assert(webauthn)
      },
      verify: async (nonce, webauthn) => await io.verify({ nonce, uid, webauthn }),
    },
    uid,
    signal,
  )

export interface SignedDisplay {
  tone: 'green' | 'red'
  title: 'ADMIT' | 'REJECT'
  detail: string
  banner?: 'network'
}

export const displayOf = (o: SignedOutcome): SignedDisplay => {
  if (o.kind === 'error') {
    return o.network
      ? { banner: 'network', detail: o.error, title: 'REJECT', tone: 'red' }
      : { detail: o.error, title: 'REJECT', tone: 'red' }
  }
  return o.body.decision === 'ADMIT'
    ? {
        // An Identified pass has no address to show.
        detail: o.body.holder === undefined || hasNoHolder(o.body.holder) ? '' : o.body.holder,
        title: 'ADMIT',
        tone: 'green',
      }
    : { detail: o.body.reason, title: 'REJECT', tone: 'red' }
}
