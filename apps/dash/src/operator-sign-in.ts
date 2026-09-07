import type { Hex, IssuerMeResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'

import type { signInChallenge, signInVerify } from './api.ts'
import type { Eip1193Provider } from './wallet.ts'

export interface SignInIo {
  challenge: typeof signInChallenge
  issuerMe: (token: string) => Promise<Result<IssuerMeResponse>>
  personalSign: (provider: Eip1193Provider, address: Hex, message: string) => Promise<Hex>
  provider: () => Promise<Eip1193Provider>
  requestAccount: (provider: Eip1193Provider) => Promise<Hex>
  verify: typeof signInVerify
}

// Why the sign-in failed, in the terms the screen explains it. `wallet` covers
// a cancelled ceremony and a provider that returned nothing usable; `rejected`
// is the api refusing the nonce or the signature; `unavailable` is the api
// being unable to check the signature at all.
export type SignInFailure = 'network' | 'rejected' | 'unavailable' | 'wallet'

export type SignInOutcome =
  | { ok: true; token: string; issuer: IssuerMeResponse }
  | { ok: false; failure: SignInFailure }

const failureOf = (status: number, network: boolean): SignInFailure => {
  if (network) {
    return 'network'
  }
  if (status === 401 || status === 400) {
    return 'rejected'
  }
  return 'unavailable'
}

// challenge → sign → verify → load the issuer this operator already owns.
// Every step is injected, so the whole flow is exercised without a wallet.
export const signInWithPasskey = async (io: SignInIo): Promise<SignInOutcome> => {
  let address: Hex
  let provider: Eip1193Provider
  try {
    provider = await io.provider()
    address = await io.requestAccount(provider)
  } catch {
    return { failure: 'wallet', ok: false }
  }

  const challenge = await io.challenge(address)
  if (!challenge.ok) {
    return { failure: failureOf(challenge.status, challenge.network), ok: false }
  }

  let signature: Hex
  try {
    signature = await io.personalSign(provider, address, challenge.body.message)
  } catch {
    return { failure: 'wallet', ok: false }
  }

  const verified = await io.verify({ address, nonce: challenge.body.nonce, signature })
  if (!verified.ok) {
    return { failure: failureOf(verified.status, verified.network), ok: false }
  }

  const { token } = verified.body
  const me = await io.issuerMe(token)
  // The session is valid even when the follow-up read fails; the operator
  // simply starts on the designer, and /issuers rejects a duplicate anyway.
  const issuer: IssuerMeResponse = me.ok ? me.body : { cards: [], issuer: null, publicUrl: null }
  return { issuer, ok: true, token }
}
