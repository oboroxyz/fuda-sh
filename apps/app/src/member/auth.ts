import { authenticateWallet } from '@fuda/libs/auth'
import type { WalletSignInIo } from '@fuda/libs/auth'
import type { MemberSessionResponse, MemberSignInResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { baseAccountProvider } from '../base-account.ts'
import { API_BASE_URL } from '../config.ts'
import { personalSign, requestAccount } from '../wallet.ts'

export interface MemberAppIo extends WalletSignInIo<MemberSignInResponse> {
  logout: (token: string) => Promise<Result<{ loggedOut: true }>>
  me: (token: string) => Promise<Result<MemberSessionResponse>>
}

export const DEFAULT_MEMBER_IO: MemberAppIo = {
  challenge: async (address) =>
    await apiFetch(API_BASE_URL, '/auth/member/challenge', {
      body: JSON.stringify({ address }),
      method: 'POST',
    }),
  logout: async (token) => await apiFetch(API_BASE_URL, '/auth/member/logout', { method: 'POST', token }),
  me: async (token) => await apiFetch(API_BASE_URL, '/auth/member/me', { method: 'GET', token }),
  personalSign,
  provider: baseAccountProvider,
  requestAccount,
  verify: async (body) =>
    await apiFetch(API_BASE_URL, '/auth/member/verify', {
      body: JSON.stringify(body),
      method: 'POST',
    }),
}

export const signInMember = async (io: MemberAppIo, signal?: AbortSignal) =>
  await authenticateWallet(io, signal)
