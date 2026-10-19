import * as v from 'valibot'

import type { CardView, IssuerView } from './handles.ts'

// docs/specs/connected-apps.md — a browser-only app an operator registers in
// the dashboard, approves for one of their issuers, and that then acts for that
// issuer with an access token. Everything here is shared by the api, which
// enforces it, and the dashboard, which shows it.

// What an access token may do. A token carries a subset, fixed at approval.
export const CONNECTED_APP_SCOPES = ['cards:read', 'cards:write'] as const
export type ConnectedAppScope = (typeof CONNECTED_APP_SCOPES)[number]

export const CONNECTED_APP_NAME_MAX_LENGTH = 60
export const CONNECTED_APP_REDIRECT_URI_MAX = 5
export const REDIRECT_URI_MAX_LENGTH = 2048

const isScope = (value: string): value is ConnectedAppScope =>
  CONNECTED_APP_SCOPES.some((scope) => scope === value)

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// The canonical form of a redirect URI, or null when fuda will not send a code
// to it: https anywhere, plain http only to this machine, never a fragment or
// credentials. Comparison is exact on this form, so `https://a.example` and
// `https://a.example/` are the same registration and `/cb` and `/cb/` are not.
export const normalizeRedirectUri = (raw: string): string | null => {
  if (raw.length === 0 || raw.length > REDIRECT_URI_MAX_LENGTH) {
    return null
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  if (!secure || url.hash !== '' || raw.includes('#') || url.username !== '' || url.password !== '') {
    return null
  }
  return url.href
}

// A space-separated scope parameter as OAuth writes it. Empty asks for every
// scope; an unknown or repeated name makes the whole request invalid.
export const parseScope = (raw: string | undefined): ConnectedAppScope[] | null => {
  const names = (raw ?? '').split(' ').filter((name) => name !== '')
  if (names.length === 0) {
    return [...CONNECTED_APP_SCOPES]
  }
  if (new Set(names).size !== names.length || !names.every(isScope)) {
    return null
  }
  return CONNECTED_APP_SCOPES.filter((scope) => names.includes(scope))
}

const redirectUri = v.pipe(
  v.string(),
  v.check((raw) => normalizeRedirectUri(raw) !== null, 'redirect URI must be https (or http on localhost)'),
)

export const ConnectedAppBody = v.strictObject({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(CONNECTED_APP_NAME_MAX_LENGTH)),
  redirectUris: v.pipe(
    v.array(redirectUri),
    v.minLength(1),
    v.maxLength(CONNECTED_APP_REDIRECT_URI_MAX),
    v.check(
      (uris) => new Set(uris.map(normalizeRedirectUri)).size === uris.length,
      'a redirect URI is listed once',
    ),
  ),
})
export type ConnectedAppRequest = v.InferOutput<typeof ConnectedAppBody>

// PKCE (RFC 7636): only S256, and a verifier/challenge of the RFC's alphabet.
const PKCE_RE = /^[A-Za-z0-9._~-]{43,128}$/u

// The dashboard's approval, sent with the operator's session. `state` is opaque
// to fuda and goes back to the app untouched.
export const AuthorizeApprovalBody = v.strictObject({
  clientId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  codeChallenge: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/u)),
  codeChallengeMethod: v.literal('S256'),
  issuerId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  redirectUri: v.pipe(v.string(), v.maxLength(REDIRECT_URI_MAX_LENGTH)),
  scope: v.optional(v.pipe(v.string(), v.maxLength(200)), ''),
  state: v.optional(v.pipe(v.string(), v.maxLength(500)), ''),
})
export type AuthorizeApprovalRequest = v.InferOutput<typeof AuthorizeApprovalBody>

// The token request (RFC 6749 §4.1.3 plus RFC 7636 §4.5), read from a form or
// JSON body with the RFC's own parameter names.
export const TokenRequestBody = v.object({
  client_id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  code: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  code_verifier: v.pipe(v.string(), v.regex(PKCE_RE)),
  grant_type: v.string(),
  redirect_uri: v.pipe(v.string(), v.maxLength(REDIRECT_URI_MAX_LENGTH)),
})

export interface ConnectedAppView {
  clientId: string
  name: string
  redirectUris: string[]
  createdAt: number
}

export interface ConnectedAppsResponse {
  apps: ConnectedAppView[]
}

export interface ConnectedAppResponse {
  app: ConnectedAppView
}

// The part of an issuer an app or the consent screen needs to name it.
export interface ConnectedIssuerView {
  id: string
  handle: string
  name: string
  logoUrl: string | null
}

// One live approval: an unexpired, unrevoked access token.
export interface ConnectedAppGrantView {
  id: string
  clientId: string
  appName: string
  issuer: ConnectedIssuerView
  scope: ConnectedAppScope[]
  createdAt: number
  expiresAt: number
}

export interface ConnectedAppGrantsResponse {
  grants: ConnectedAppGrantView[]
}

// GET /oauth/authorize — what the consent screen shows before approval.
export interface AuthorizePreviewResponse {
  app: { clientId: string; name: string }
  redirectUri: string
  scope: ConnectedAppScope[]
  issuers: ConnectedIssuerView[]
}

export interface AuthorizeApprovalResponse {
  redirectTo: string
}

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
  issuer: ConnectedIssuerView
}

// The resource routes under /connect, all bound to the token's one issuer.
export interface ConnectIssuerResponse {
  issuer: IssuerView
  // the venue page; a card's own link is `${publicUrl}/${card.slug}`
  publicUrl: string
  scope: ConnectedAppScope[]
}

export interface ConnectCardsResponse {
  cards: CardView[]
  publicUrl: string
}

export interface ConnectCardResponse {
  card: CardView
  // the card's own public page, where a member claims it
  url: string
}
