import type { ChallengeResponse, Hex, VerifySignedResponse } from '@fuda/sdk'
import type { Result } from '@fuda/web-kit'

export interface SignedGateIo {
  challenge: (uid: Hex) => Promise<Result<ChallengeResponse>>
  sign: (message: string) => Promise<Hex>
  verify: (body: { uid: Hex; nonce: Hex; signature: Hex }) => Promise<Result<VerifySignedResponse>>
}

export type SignedOutcome =
  | { kind: 'verdict'; body: VerifySignedResponse }
  | { kind: 'error'; error: string; network: boolean }

// The member-side flow (docs/specs/pass-types-and-flows.md#gate-protocol): mint → sign the exact challenge string →
// verify. The wallet signs what the api minted, byte for byte; nothing here
// reconstructs the message.
export const enterSigned = async (io: SignedGateIo, uid: Hex): Promise<SignedOutcome> => {
  const minted = await io.challenge(uid)
  if (!minted.ok) {
    return { error: minted.error, kind: 'error', network: minted.network }
  }
  let signature: Hex
  try {
    signature = await io.sign(minted.body.challenge)
  } catch (error) {
    // A refused prompt is the member's own choice, not an outage: no network banner.
    return {
      error: error instanceof Error ? error.message : 'signing failed',
      kind: 'error',
      network: false,
    }
  }
  const verified = await io.verify({ nonce: minted.body.nonce, signature, uid })
  if (!verified.ok) {
    return { error: verified.error, kind: 'error', network: verified.network }
  }
  return { body: verified.body, kind: 'verdict' }
}

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
    ? { detail: o.body.holder ?? '', title: 'ADMIT', tone: 'green' }
    : { detail: o.body.reason, title: 'REJECT', tone: 'red' }
}
