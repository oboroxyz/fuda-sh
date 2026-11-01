import { authenticateWallet } from '@fuda/libs/auth'
import type { SignInFailure } from '@fuda/libs/auth'
import type { Hex, IssuerView } from '@fuda/sdk'

import type { signInChallenge } from './api.ts'
import type { verifyOperator } from './session-client.ts'
import type { Eip1193Provider } from './wallet.ts'

export interface SignInIo {
  challenge: typeof signInChallenge
  personalSign: (provider: Eip1193Provider, address: Hex, message: string) => Promise<Hex>
  provider: () => Promise<Eip1193Provider>
  requestAccount: (provider: Eip1193Provider) => Promise<Hex>
  verify: typeof verifyOperator
}

export type { SignInFailure } from '@fuda/libs/auth'
// The session itself is a cookie the Worker set; the browser learns only
// whether the operator already has a venue, which decides where it lands.
export type SignInOutcome = { ok: true; hasIssuer: boolean } | { ok: false; failure: SignInFailure }

export const signInWithPasskey = async (io: SignInIo): Promise<SignInOutcome> => {
  const verified = await authenticateWallet<{ issuer: IssuerView | null }>(io)
  return verified.ok ? { hasIssuer: verified.session.issuer !== null, ok: true } : verified
}
