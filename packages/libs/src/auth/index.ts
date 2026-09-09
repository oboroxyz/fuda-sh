import type { Hex, SignInChallengeResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'

import type { Eip1193Provider } from '../wallet/index.ts'

export interface WalletSignInIo<T> {
  challenge: (address: Hex) => Promise<Result<SignInChallengeResponse>>
  personalSign: (provider: Eip1193Provider, address: Hex, message: string) => Promise<Hex>
  provider: () => Promise<Eip1193Provider>
  requestAccount: (provider: Eip1193Provider) => Promise<Hex>
  verify: (body: { address: Hex; nonce: Hex; signature: Hex }) => Promise<Result<T>>
}

// Why the sign-in failed, in the terms the screen explains it. `wallet` covers
// a cancelled ceremony and a provider that returned nothing usable; `rejected`
// is the api refusing the nonce or the signature; `unavailable` is the api
// being unable to check the signature at all.
export type SignInFailure = 'network' | 'rejected' | 'unavailable' | 'wallet'

export type SignInOutcome<T> = { ok: true; session: T } | { ok: false; failure: SignInFailure }

const failureOf = (status: number, network: boolean): SignInFailure => {
  if (network) {
    return 'network'
  }
  if (status === 401 || status === 400) {
    return 'rejected'
  }
  return 'unavailable'
}

// Request the account, then prove control with the server challenge.
// Every step is injected, so the whole flow is exercised without a wallet.
export const authenticateWallet = async <T>(
  io: WalletSignInIo<T>,
  signal?: AbortSignal,
): Promise<SignInOutcome<T>> => {
  // Stop future prompts and requests after cancellation. An already open wallet
  // ceremony or submitted HTTP request remains owned by its provider.
  const canceled = (): boolean => signal?.aborted === true
  if (canceled()) {
    return { failure: 'wallet', ok: false }
  }
  let address: Hex
  let provider: Eip1193Provider
  try {
    provider = await io.provider()
    if (canceled()) {
      return { failure: 'wallet', ok: false }
    }
    address = await io.requestAccount(provider)
  } catch {
    return { failure: 'wallet', ok: false }
  }

  if (canceled()) {
    return { failure: 'wallet', ok: false }
  }
  const challenge = await io.challenge(address)
  if (canceled()) {
    return { failure: 'wallet', ok: false }
  }
  if (!challenge.ok) {
    return { failure: failureOf(challenge.status, challenge.network), ok: false }
  }

  let signature: Hex
  try {
    signature = await io.personalSign(provider, address, challenge.body.message)
  } catch {
    return { failure: 'wallet', ok: false }
  }

  if (canceled()) {
    return { failure: 'wallet', ok: false }
  }
  const verified = await io.verify({ address, nonce: challenge.body.nonce, signature })
  if (canceled()) {
    return { failure: 'wallet', ok: false }
  }
  if (!verified.ok) {
    return { failure: failureOf(verified.status, verified.network), ok: false }
  }

  return { ok: true, session: verified.body }
}

export { createTokenStore } from './token-store.ts'
export { createSessionGeneration } from './session-generation.ts'
export type { SessionGeneration } from './session-generation.ts'
