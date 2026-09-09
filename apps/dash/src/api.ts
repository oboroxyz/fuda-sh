import type {
  CardCheckResponse,
  CardCreateResponse,
  EnsClaimView,
  CardRequest,
  HandleCheckResponse,
  Hex,
  IssuerCreateRequest,
  IssuerCreateResponse,
  IssuerMeResponse,
  IssuerView,
  IssueResponse,
  MembersResponse,
  RevokeResponse,
  ReceptionResponse,
  StampSettings,
  SignInChallengeResponse,
  SignInResponse,
} from '@fuda/sdk'
import { API_VERSION_PREFIX, apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'
import * as v from 'valibot'

import { API_BASE_URL } from './config.ts'
import type { ClaimVoucherResponse } from './ens-claim.ts'
import { LOGO_VARIANTS } from './logo.ts'
import type { LogoSet } from './logo.ts'

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

export const readStampSettings = async (token: string): Promise<Result<StampSettings>> =>
  await apiFetch<StampSettings>(API_BASE_URL, '/issuers/me/stamps', { token })

export const updateStampSettings = async (
  token: string,
  body: StampSettings,
): Promise<Result<StampSettings>> =>
  await apiFetch<StampSettings>(API_BASE_URL, '/issuers/me/stamps', {
    body: JSON.stringify(body),
    method: 'PUT',
    token,
  })

export const receiveAtReception = async (
  token: string,
  qr: string,
  requestId: string,
): Promise<Result<ReceptionResponse>> =>
  await apiFetch<ReceptionResponse>(API_BASE_URL, '/issuers/me/reception', {
    body: JSON.stringify({ qr, requestId }),
    method: 'POST',
    token,
  })

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
export const createCard = async (token: string, body: CardRequest): Promise<Result<CardCreateResponse>> =>
  await apiFetch<CardCreateResponse>(API_BASE_URL, '/issuers/cards', {
    body: JSON.stringify(body),
    method: 'POST',
    token,
  })

// The venue's logo. `POST /issuers/logo` stages the four PNGs for 15 minutes
// and the id is spent once, either by `POST /issuers` with the venue or by the
// commit route below.
export interface LogoUploadResponse {
  expiresAt: number
  logoUploadId: string
}

const UploadBody = v.object({
  expiresAt: v.number(),
  logoUploadId: v.pipe(v.string(), v.minLength(1)),
})

const ErrorBody = v.object({ error: v.string() })

// The mapping `apiFetch` applies, for the one call that cannot use it. The one
// departure is 501: the upload route answers it when the api has no media
// bucket, which is a deployment state to explain, not an outage to retry.
const MEDIA_NOT_CONFIGURED = 501

const resultOf = async <T>(schema: v.GenericSchema<unknown, T>, res: Response): Promise<Result<T>> => {
  if (res.status >= 500 && res.status !== MEDIA_NOT_CONFIGURED) {
    return { error: `api ${res.status}`, network: true, ok: false, status: res.status }
  }
  const json: unknown = await res.json().catch(() => null)
  if (res.ok) {
    const parsed = v.safeParse(schema, json)
    return parsed.success
      ? { body: parsed.output, ok: true }
      : { error: 'bad_response', network: false, ok: false, status: res.status }
  }
  const failed = v.safeParse(ErrorBody, json)
  return {
    error: failed.success ? failed.output.error : `api ${res.status}`,
    network: false,
    ok: false,
    status: res.status,
  }
}

// `apiFetch` sets `content-type: application/json` for every body it sends, and
// that header wins over the caller's. A multipart body must carry the boundary
// the browser chose, so this one call goes through `fetch` directly and maps the
// response exactly as `apiFetch` would.
export const uploadLogo = async (token: string, variants: LogoSet): Promise<Result<LogoUploadResponse>> => {
  const form = new FormData()
  for (const variant of LOGO_VARIANTS) {
    form.append(variant, variants[variant], `${variant}.png`)
  }
  try {
    // Multipart, so it goes out by hand rather than through `apiFetch` — the
    // version prefix has to be added here too.
    const res = await fetch(`${API_BASE_URL.replace(/\/$/u, '')}${API_VERSION_PREFIX}/issuers/logo`, {
      body: form,
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
    })
    return await resultOf(UploadBody, res)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'network error',
      network: true,
      ok: false,
      status: 0,
    }
  }
}

// Points the venue this session already owns at a staged upload.
export const commitLogo = async (
  token: string,
  logoUploadId: string,
): Promise<Result<{ issuer: IssuerView }>> =>
  await apiFetch<{ issuer: IssuerView }>(API_BASE_URL, '/issuers/logo/commit', {
    body: JSON.stringify({ logoUploadId }),
    method: 'POST',
    token,
  })

// The venue's ENS name. Signing the voucher and recording the claim are two
// calls because a wallet prompt and a chain confirmation sit between them
// (docs/specs/ens-naming.md#issuer-claim-and-renewal).
export const claimVoucher = async (token: string): Promise<Result<ClaimVoucherResponse>> =>
  await apiFetch<ClaimVoucherResponse>(API_BASE_URL, '/issuers/me/ens/claim-voucher', {
    body: '{}',
    method: 'POST',
    token,
  })

export const confirmEnsClaim = async (token: string, txHash: Hex): Promise<Result<EnsClaimView>> =>
  await apiFetch<EnsClaimView>(API_BASE_URL, '/issuers/me/ens/claimed', {
    body: JSON.stringify({ txHash }),
    method: 'POST',
    token,
  })
