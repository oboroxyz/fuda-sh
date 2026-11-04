import { ClaimSource, passUrls } from '@fuda/sdk'
import type {
  ChallengeResponse,
  Hex,
  PassCardResponse,
  PassCardView,
  PublicVenue,
  SelfServeIssueResponse,
  StampSummary,
  VerifyResponse,
  VerifySignedResponse,
} from '@fuda/sdk'
import { apiFetch, fetchJson } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'
import * as v from 'valibot'

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

export const fetchStampSummary = async (uid: Hex): Promise<StampSummary | null> => {
  const result = await apiFetch<StampSummary>(API_BASE_URL, `/stamps/${uid}`, { method: 'GET' })
  return result.ok ? result.body : null
}

// The venue card behind a pass, so the list can draw it in the venue's look.
// It lives beside the pass itself, outside /v1, so it is reached by that URL
// rather than through the prefix. A pass without a venue card, or one that
// cannot be read right now, keeps the plain fuda look.
export const fetchPassCard = async (uid: Hex): Promise<PassCardView | null> => {
  const result = await fetchJson<PassCardResponse>(`${passUrls(API_BASE_URL, uid).web}/card`, {
    method: 'GET',
  })
  return result.ok ? result.body.card : null
}

// The venue behind /@<handle> and every card it publishes: what a member sees
// before asking for one. A handle nobody owns answers 404 `not_found`.
export const fetchVenue = async (handle: string): Promise<Result<PublicVenue>> =>
  await apiFetch<PublicVenue>(API_BASE_URL, `/issuers/${encodeURIComponent(handle)}`, { method: 'GET' })

// The label on the link a person arrived through, `?source=spring-flyer`, if it
// has the shape the api keeps (docs/specs/pass-types-and-flows.md#capacity-and-source).
export const claimSourceFrom = (search: string): string | null => {
  const parsed = v.safeParse(ClaimSource, new URLSearchParams(search).get('source'))
  return parsed.success ? parsed.output : null
}

// Self-serve Bearer issuance of one card: no account. The api answers 429
// `rate_limited`, 403 `bot_check_failed`, 409 `card_closed` or `card_sold_out`,
// 501 `no_signer`, 502 `chain_error`, 503 `bot_check_unavailable` or 404 `not_found`
// (for an unknown handle as well as an unknown slug). `turnstileToken` is the
// Turnstile answer for this one claim; a token works once, so a retry brings a new one.
export const issueCard = async (
  handle: string,
  slug: string,
  source: string | null,
  turnstileToken: string | null = null,
): Promise<Result<SelfServeIssueResponse>> => {
  const path = `/issuers/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/issue`
  if (source === null && turnstileToken === null) {
    return await apiFetch<SelfServeIssueResponse>(API_BASE_URL, path, { method: 'POST' })
  }
  return await apiFetch<SelfServeIssueResponse>(API_BASE_URL, path, {
    // JSON.stringify leaves out an undefined member.
    body: JSON.stringify({ source: source ?? undefined, turnstileToken: turnstileToken ?? undefined }),
    method: 'POST',
  })
}

export type CardFailure =
  | 'bot_check_failed'
  | 'bot_check_unavailable'
  | 'card_closed'
  | 'card_sold_out'
  | 'chain_error'
  | 'network'
  | 'no_signer'
  | 'not_found'
  | 'rate_limited'

// `apiFetch` folds every 5xx into a network condition and keeps only the
// status, so the card screen tells the api's 501 and 502 apart by status
// rather than by the error code the body carried.
export const cardFailureOf = (result: { status: number; error: string }): CardFailure => {
  switch (result.status) {
    case 403: {
      return result.error === 'bot_check_failed' ? 'bot_check_failed' : 'network'
    }
    case 404: {
      return 'not_found'
    }
    case 409: {
      return result.error === 'card_sold_out' ? 'card_sold_out' : 'card_closed'
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
    case 503: {
      return 'bot_check_unavailable'
    }
    default: {
      return 'network'
    }
  }
}

// The Google Wallet save link, or null when the api has no Google credentials
// (501 `google_not_configured`) — the button stays hidden in that case.
export const googleSaveUrl = async (url: string): Promise<string | null> => await googlePassHref(url)
