import type {
  ChallengeResponse,
  Hex,
  PublicVenue,
  SelfServeIssueResponse,
  VerifyResponse,
  VerifySignedResponse,
} from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'
import { googlePassHref } from './member-pass-list.ts'

export const challenge = async (uid: Hex): Promise<Result<ChallengeResponse>> =>
  await apiFetch<ChallengeResponse>(API_BASE_URL, '/challenge', {
    body: JSON.stringify({ uid }),
    method: 'POST',
  })

export const verifySigned = async (body: {
  uid: Hex
  nonce: Hex
  signature: Hex
}): Promise<Result<VerifySignedResponse>> =>
  await apiFetch<VerifySignedResponse>(API_BASE_URL, '/verify-signed', {
    body: JSON.stringify(body),
    method: 'POST',
  })

export const verifyUid = async (uid: Hex): Promise<Result<VerifyResponse>> =>
  await apiFetch<VerifyResponse>(API_BASE_URL, `/verify/${uid}`, { method: 'GET' })

// The venue behind /@<handle> and every card it publishes: what a member sees
// before asking for one. A handle nobody owns answers 404 `not_found`.
export const fetchVenue = async (handle: string): Promise<Result<PublicVenue>> =>
  await apiFetch<PublicVenue>(API_BASE_URL, `/issuers/${encodeURIComponent(handle)}`, { method: 'GET' })

// Self-serve Bearer issuance of one card: no body, no account. The api answers
// 429 `rate_limited`, 501 `no_signer`, 502 `chain_error` or 404 `not_found`
// (for an unknown handle as well as an unknown slug).
export const issueCard = async (handle: string, slug: string): Promise<Result<SelfServeIssueResponse>> =>
  await apiFetch<SelfServeIssueResponse>(
    API_BASE_URL,
    `/issuers/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/issue`,
    { method: 'POST' },
  )

export type CardFailure = 'chain_error' | 'network' | 'no_signer' | 'not_found' | 'rate_limited'

// `apiFetch` folds every 5xx into a network condition and keeps only the
// status, so the card screen tells the api's 501 and 502 apart by status
// rather than by the error code the body carried.
export const cardFailureOf = (result: { status: number; error: string }): CardFailure => {
  switch (result.status) {
    case 404: {
      return 'not_found'
    }
    case 429: {
      return 'rate_limited'
    }
    case 501: {
      return 'no_signer'
    }
    case 502: {
      return 'chain_error'
    }
    default: {
      return 'network'
    }
  }
}

// The Google Wallet save link, or null when the api has no Google credentials
// (501 `google_not_configured`) — the button stays hidden in that case.
export const googleSaveUrl = async (url: string): Promise<string | null> => await googlePassHref(url)
