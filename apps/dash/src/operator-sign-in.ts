import { authenticateWallet, passkeyClient } from '@fuda/libs/auth'
import type { PasskeyFailure, PasskeyOutcome, SignInFailure } from '@fuda/libs/auth'
import type { Hex, IssuerView } from '@fuda/sdk'

import { signInChallenge } from './api.ts'
import { API_BASE_URL, ENS_PAYMASTER_URL } from './config.ts'
import { verifyOperator } from './session-client.ts'
import { apiFetch, fetchJson } from './session-request.ts'
import { baseAccountProvider, personalSign, requestAccount } from './wallet.ts'
import type { Eip1193Provider } from './wallet.ts'

export interface WalletSignInIo {
  challenge: typeof signInChallenge
  personalSign: (provider: Eip1193Provider, address: Hex, message: string) => Promise<Hex>
  provider: () => Promise<Eip1193Provider>
  requestAccount: (provider: Eip1193Provider) => Promise<Hex>
  verify: typeof verifyOperator
}

const BASE_ACCOUNT: WalletSignInIo = {
  challenge: signInChallenge,
  personalSign,
  provider: async () => await baseAccountProvider(ENS_PAYMASTER_URL),
  requestAccount,
  verify: verifyOperator,
}

export type { SignInFailure } from '@fuda/libs/auth'
export type OperatorSignInFailure = PasskeyFailure | SignInFailure
// The session itself is a cookie the Worker set; the browser learns only
// whether the operator already has a venue, which decides where it lands.
export type SignInOutcome = { ok: true; hasIssuer: boolean } | { ok: false; failure: OperatorSignInFailure }

interface SignedIn {
  issuer: IssuerView | null
}

export const operatorPasskeys = passkeyClient<SignedIn>('operator', {
  api: async (path, init) => await apiFetch(API_BASE_URL, path, init),
  session: fetchJson,
})

const outcomeOf = (result: PasskeyOutcome<SignedIn>): SignInOutcome =>
  result.ok ? { hasIssuer: result.session.issuer !== null, ok: true } : result

export const signInWithPasskey = async (): Promise<SignInOutcome> =>
  outcomeOf(await operatorPasskeys.signIn())

export const createPasskeyAccount = async (): Promise<SignInOutcome> =>
  outcomeOf(await operatorPasskeys.create())

// Secondary: an ENS claim and a venue made before passkeys need the wallet itself
// (../../../docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
export const signInWithWallet = async (io: WalletSignInIo = BASE_ACCOUNT): Promise<SignInOutcome> => {
  const verified = await authenticateWallet<SignedIn>(io)
  return verified.ok ? { hasIssuer: verified.session.issuer !== null, ok: true } : verified
}
