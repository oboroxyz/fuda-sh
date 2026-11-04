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
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import * as v from 'valibot'

import { API_BASE_URL } from './config.ts'
import { googlePassHref } from './member-pass-list.ts'

export const challenge = async (uid: Hex): Promise<Result<ChallengeResponse>> =>
  await apiFetch<ChallengeResponse>(API_BASE_URL, '/challenge', {
    body: JSON.stringify({ uid }),
    credentials: 'omit',
    method: 'POST',
  })

export const verifySigned = async (
  body: { uid: Hex; nonce: Hex } & ({ signature: Hex } | { webauthn: AuthenticationResponseJSON }),
): Promise<Result<VerifySignedResponse>> =>
  await apiFetch<VerifySignedResponse>(API_BASE_URL, '/verify-signed', {
    body: JSON.stringify(body),
    credentials: 'omit',
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

const issuePath = (handle: string, slug: string): string =>
  `/issuers/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/issue`

// Self-serve issuance of one card: no account. The api answers 429
// `rate_limited`, 409 `card_closed` or `card_sold_out`, 501 `no_signer`, 502
// `chain_error` or 404 `not_found` (for an unknown handle as well as an unknown slug).
export const issueCard = async (
  handle: string,
  slug: string,
  source: string | null,
  turnstileToken: string | null = null,
): Promise<Result<SelfServeIssueResponse>> => {
  const path = issuePath(handle, slug)
  if (source === null && turnstileToken === null) {
    return await apiFetch<SelfServeIssueResponse>(API_BASE_URL, path, { method: 'POST' })
  }
  return await apiFetch<SelfServeIssueResponse>(API_BASE_URL, path, {
    body: JSON.stringify({ source: source ?? undefined, turnstileToken: turnstileToken ?? undefined }),
    method: 'POST',
  })
}

// The same route for a card bound to a passkey, which also takes the member's session
// and this claim's assertion, and answers 401 without a session and 403 for a passkey it
// refuses.
export const issuePasskeyCard = async (
  handle: string,
  slug: string,
  source: string | null,
  webauthn: AuthenticationResponseJSON,
  turnstileToken: string | null = null,
): Promise<Result<SelfServeIssueResponse>> =>
  await apiFetch<SelfServeIssueResponse>(API_BASE_URL, issuePath(handle, slug), {
    body: JSON.stringify({
      source: source ?? undefined,
      turnstileToken: turnstileToken ?? undefined,
      webauthn,
    }),
    method: 'POST',
  })

// The same route for a Sensitive card: only the address of a key this device derived. The
// api reads no session for it.
export const issueSensitiveCard = async (
  handle: string,
  slug: string,
  source: string | null,
  holderAddress: Hex,
  turnstileToken: string | null = null,
): Promise<Result<SelfServeIssueResponse>> =>
  await apiFetch<SelfServeIssueResponse>(API_BASE_URL, issuePath(handle, slug), {
    body: JSON.stringify({
      holderAddress,
      source: source ?? undefined,
      turnstileToken: turnstileToken ?? undefined,
    }),
    credentials: 'omit',
    method: 'POST',
  })

export type CardFailure =
  | 'bot_check_failed'
  | 'bot_check_unavailable'
  | 'card_closed'
  | 'card_sold_out'
  | 'chain_error'
  | 'network'
  | 'no_signer'
  | 'not_found'
  | 'passkey_cancelled'
  | 'passkey_refused'
  | 'rate_limited'
  | 'secret_unopenable'
  | 'signed_out'

// `apiFetch` folds every 5xx into a network condition and keeps only the
// status, so the card screen tells the api's 501 and 502 apart by status
// rather than by the error code the body carried.
export const cardFailureOf = (result: { status: number; error: string }): CardFailure => {
  switch (result.status) {
    case 401: {
      return 'signed_out'
    }
    case 403: {
      return result.error === 'bot_check_failed' ? 'bot_check_failed' : 'passkey_refused'
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
    case 503: {
      return 'bot_check_unavailable'
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
