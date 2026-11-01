import { authenticateWallet } from '@fuda/libs/auth'
import type { WalletSignInIo } from '@fuda/libs/auth'
import type { Hex } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'

import { baseAccountProvider } from '../base-account.ts'
import { API_BASE_URL } from '../config.ts'
import { verifyMember } from '../session-client.ts'
import { personalSign, requestAccount } from '../wallet.ts'

// The wallet signs the api's challenge in the browser; the Worker's session
// route spends the signature and keeps the session in an HttpOnly cookie.
export type MemberAppIo = WalletSignInIo<{ address: Hex }>

export const DEFAULT_MEMBER_IO: MemberAppIo = {
  challenge: async (address) =>
    await apiFetch(API_BASE_URL, '/auth/member/challenge', {
      body: JSON.stringify({ address }),
      method: 'POST',
    }),
  personalSign,
  provider: baseAccountProvider,
  requestAccount,
  verify: verifyMember,
}

export const signInMember = async (io: MemberAppIo, signal?: AbortSignal) =>
  await authenticateWallet(io, signal)
