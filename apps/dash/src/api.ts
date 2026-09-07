import type {
  CardCheckResponse,
  CardRequest,
  HandleCheckResponse,
  Hex,
  IssuerCreateRequest,
  IssuerCreateResponse,
  IssuerMeResponse,
  IssueResponse,
  MembersResponse,
  RevokeResponse,
  SignInChallengeResponse,
  SignInResponse,
} from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'

export type { Result } from '@fuda/sdk/http'

// The admin token lives only in memory for the tab's lifetime (docs/specs/pass-types-and-flows.md#surfaces). It is
// fuda's API authorization, not a user account: an api with ADMIN_TOKEN unset
// serves every admin route without authorization and ignores this header.
export const listMembers = async (token: string): Promise<Result<MembersResponse>> =>
  await apiFetch<MembersResponse>(API_BASE_URL, '/members', { token })

export const issueRight = async (
  token: string,
  body: Record<string, string | number>,
): Promise<Result<IssueResponse>> =>
  await apiFetch<IssueResponse>(API_BASE_URL, '/issue', {
    body: JSON.stringify(body),
    method: 'POST',
    token,
  })

export const revokeRight = async (token: string, uid: string): Promise<Result<RevokeResponse>> =>
  await apiFetch<RevokeResponse>(API_BASE_URL, '/revoke', {
    body: JSON.stringify({ uid }),
    method: 'POST',
    token,
  })

// Operator sign-in (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route):
// the passkey wallet signs the api's message and receives a session token. The
// admin token above is a deployment credential; a session token is an identity.
export const signInChallenge = async (address: Hex): Promise<Result<SignInChallengeResponse>> =>
  await apiFetch<SignInChallengeResponse>(API_BASE_URL, '/auth/challenge', {
    body: JSON.stringify({ address }),
    method: 'POST',
  })

export const signInVerify = async (body: {
  address: Hex
  nonce: Hex
  signature: Hex
}): Promise<Result<SignInResponse>> =>
  await apiFetch<SignInResponse>(API_BASE_URL, '/auth/verify', {
    body: JSON.stringify(body),
    method: 'POST',
  })

export const signOut = async (token: string): Promise<Result<{ loggedOut: true }>> =>
  await apiFetch<{ loggedOut: true }>(API_BASE_URL, '/auth/logout', { body: '{}', method: 'POST', token })

export const issuerMe = async (token: string): Promise<Result<IssuerMeResponse>> =>
  await apiFetch<IssuerMeResponse>(API_BASE_URL, '/issuers/me', { token })

export const checkHandle = async (token: string, handle: string): Promise<Result<HandleCheckResponse>> =>
  await apiFetch<HandleCheckResponse>(API_BASE_URL, `/issuers/check?handle=${encodeURIComponent(handle)}`, {
    token,
  })

export const checkCardSlug = async (token: string, slug: string): Promise<Result<CardCheckResponse>> =>
  await apiFetch<CardCheckResponse>(API_BASE_URL, `/issuers/cards/check?slug=${encodeURIComponent(slug)}`, {
    token,
  })

export const createIssuer = async (
  token: string,
  body: IssuerCreateRequest,
): Promise<Result<IssuerCreateResponse>> =>
  await apiFetch<IssuerCreateResponse>(API_BASE_URL, '/issuers', {
    body: JSON.stringify(body),
    method: 'POST',
    token,
  })

// One more card for the venue this session already owns.
export const createCard = async (token: string, body: CardRequest): Promise<Result<IssuerCreateResponse>> =>
  await apiFetch<IssuerCreateResponse>(API_BASE_URL, '/issuers/cards', {
    body: JSON.stringify(body),
    method: 'POST',
    token,
  })
