import { authenticateWallet } from '@fuda/libs/auth'
import type { SignInFailure } from '@fuda/libs/auth'
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

export type { SignInFailure } from '@fuda/libs/auth'
export type SignInOutcome =
  | { ok: true; token: string; issuer: IssuerMeResponse }
  | { ok: false; failure: SignInFailure }

export const signInWithPasskey = async (io: SignInIo): Promise<SignInOutcome> => {
  const verified = await authenticateWallet(io)
  if (!verified.ok) {
    return verified
  }
  const { token } = verified.session
  const me = await io.issuerMe(token)
  // The session is valid even when the follow-up read fails; the operator
  // simply starts on the designer, and /issuers rejects a duplicate anyway.
  const issuer: IssuerMeResponse = me.ok ? me.body : { cards: [], ens: null, issuer: null, publicUrl: null }
  return { issuer, ok: true, token }
}
